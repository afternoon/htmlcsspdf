/**
 * The browser half of the authorization flow, scripted.
 *
 * This is the one step a test cannot perform for real: it stands in for a
 * signed-in person being redirected to the consent screen and pressing Allow.
 * Everything on either side of it — discovery, registration, PKCE, the code
 * exchange, the MCP calls — is the genuine article.
 *
 * It follows the same path a browser would, and deliberately not a shortcut
 * around it: the authorize endpoint is asked for a redirect, that redirect is
 * required to land on `/consent`, and the consent endpoint is answered exactly
 * as the consent page answers it. A change that broke the real screen would
 * break this too.
 */

/**
 * The parameters the authorization query's signature covers.
 *
 * The provider names them in repeated `ba_param` entries and signs the set, so
 * echoing the raw query string back is wrong the moment anything else appends
 * to the URL. This mirrors `buildSignedOAuthQuery` in the Better Auth client,
 * which the consent page uses for the same reason.
 */
function signedQuery(search: URLSearchParams): string {
  const covered = new Set(search.getAll("ba_param"));
  const signed = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === "sig" || key === "ba_param" || covered.has(key)) {
      signed.append(key, value);
    }
  }
  return signed.toString();
}

/**
 * Where the provider wants the browser to go next.
 *
 * It answers a navigation with a 302 and a programmatic caller with
 * `{redirect: true, url}` — and which one a caller gets turns on `Sec-Fetch-*`
 * headers, which Node's `fetch` does not send. Both are read rather than one
 * being forced, because the destination is what this step is about; how the
 * provider chose to phrase it is not part of the contract under test.
 */
async function redirectTarget(response: Response): Promise<string> {
  const location = response.headers.get("location");
  if (location) return location;

  const body = await response.text();
  const parsed = JSON.parse(body) as { redirect?: boolean; url?: string };
  if (parsed.url) return parsed.url;

  throw new Error(
    `Authorize gave no destination (status ${response.status}): ${body.slice(0, 300)}`,
  );
}

export interface Approval {
  /** The authorization code, for the client's token exchange. */
  code: string;
  /** The issuer the provider echoed back (RFC 9207). */
  iss?: string;
}

/**
 * Sign in as the holder of `cookie` and approve the pending request.
 *
 * `decision` of `"deny"` exercises the refusal path, which answers with an
 * `access_denied` redirect rather than a code.
 */
export async function approveAuthorization(
  authorizationUrl: URL,
  options: { baseUrl: string; cookie: string; decision?: "allow" | "deny" },
): Promise<Approval> {
  const { baseUrl, cookie, decision = "allow" } = options;

  const authorized = await fetch(authorizationUrl, {
    headers: { cookie, accept: "text/html" },
    redirect: "manual",
  });

  const consent = new URL(await redirectTarget(authorized), baseUrl);
  if (consent.pathname !== "/consent") {
    // Landing on /login means the session cookie was not accepted, which is
    // worth saying plainly rather than failing later on a missing code.
    throw new Error(`Expected a redirect to /consent, got ${consent.pathname}`);
  }

  // Exactly what `respondToConsent` sends, including the Origin header the
  // CSRF check requires.
  const answered = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: {
      cookie,
      origin: baseUrl,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      accept: decision === "allow",
      oauth_query: signedQuery(consent.searchParams),
    }),
  });

  if (!answered.ok) {
    throw new Error(`Consent failed (${answered.status}): ${await answered.text()}`);
  }

  const { url } = (await answered.json()) as { url?: string };
  if (!url) throw new Error("Consent did not say where to send the browser.");

  const callback = new URL(url);
  const code = callback.searchParams.get("code");
  if (!code) {
    throw new Error(
      `No authorization code: ${callback.searchParams.get("error") ?? callback.search}`,
    );
  }

  return { code, iss: callback.searchParams.get("iss") ?? undefined };
}

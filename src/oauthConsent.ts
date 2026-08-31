import { z } from "zod";
import { authClient } from "./authClient.ts";

/**
 * The consent screen's half of the OAuth provider API.
 *
 * Answering goes through `authClient`, because the provider does not park the
 * pending authorization server-side: it hands the request to this page as a
 * signed query string and expects it back as `oauth_query`. The auth client's
 * provider plugin attaches exactly the parameters the signature covers, which
 * is fiddlier than it looks and not worth reimplementing here.
 *
 * Looking the client up is a plain `fetch` — a GET carrying no such state.
 * Its response is parsed rather than cast, for the same reason the document
 * API parses its own: our server can be an older deploy than the page talking
 * to it.
 */

/** What the consent screen is allowed to know about a client. */
const PublicClientSchema = z.object({
  client_id: z.string(),
  client_name: z.string().nullish(),
  client_uri: z.string().nullish(),
  logo_uri: z.string().nullish(),
  tos_uri: z.string().nullish(),
  policy_uri: z.string().nullish(),
});
export type PublicClient = z.infer<typeof PublicClientSchema>;

/**
 * The client's self-described identity.
 *
 * Every field was supplied by whoever registered the client, so the consent
 * screen presents it as a claim rather than as a fact — see `ConsentPage`.
 */
export async function fetchPublicClient(clientId: string): Promise<PublicClient> {
  const response = await fetch(
    `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
    { headers: { accept: "application/json" }, credentials: "same-origin" },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error_description?: string;
    } | null;
    throw new Error(body?.error_description ?? `Request failed (${response.status}).`);
  }

  return PublicClientSchema.parse(await response.json());
}

/**
 * Answer the pending authorization request, and say where to go next.
 *
 * Takes no code or client id. Which request is being answered comes from the
 * signed query the plugin attaches, so a link carrying somebody else's
 * parameters cannot be made to approve anything: an unsigned or edited query
 * is rejected by the server before any consent is recorded.
 *
 * The endpoint answers with JSON rather than a redirect — it sets `accept:
 * application/json` on its own behalf before finishing the authorization — so
 * the caller performs the navigation.
 */
export async function respondToConsent(accept: boolean): Promise<string> {
  const { data, error } = await authClient.oauth2.consent({ accept });
  if (error) throw new Error(error.message ?? "Could not answer the request.");

  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("The server did not say where to go next.");
  return url;
}

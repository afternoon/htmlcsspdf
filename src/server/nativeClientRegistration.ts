import { createAuthMiddleware } from "better-auth/api";

/**
 * Letting a client on somebody's machine register itself.
 *
 * OpenID Connect's registration spec defaults `application_type` to `"web"`,
 * and a web client's redirect URIs must be https and must not be loopback. The
 * OAuth provider applies that default to every dynamic registration — but the
 * spec MCP clients register under is RFC 7591, which has no such field, so a
 * client has no obligation to send one. A client running on a command line has
 * nowhere but loopback to receive the redirect, so `claude mcp add` was turned
 * away before a person ever reached the consent screen:
 *
 *     web clients require https redirect URIs on non-loopback hosts:
 *     http://localhost:60369/callback
 *
 * The missing field is therefore derived from the redirect URIs, by the same
 * rule the MCP client SDK uses when it fills the field in itself (SEP-837): a
 * loopback host or a non-http(s) scheme means a native application, RFC 8252's
 * definition of one. Recent clients send that value already; this covers the
 * ones that do not, which is every client written against RFC 7591 alone.
 *
 * Nothing is relaxed by this. The provider still applies its native rules to
 * every URI — only the exact hosts `localhost`, `127.0.0.1` and `[::1]` may be
 * http, https loopback is refused, private-use schemes must be well-formed
 * reverse-domain names — and a client that states `application_type` keeps
 * what it stated. Registering authorises nothing in any case: every token
 * still comes from a person completing Google sign-in and the consent screen.
 */

/** The provider's own endpoint, relative to the `/api/auth` base path. */
const REGISTRATION_PATH = "/oauth2/register";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A redirect URI that only an application on somebody's machine would hold. */
function isNativeRedirectUri(redirectUri: unknown): boolean {
  if (typeof redirectUri !== "string") return false;

  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  // A private-use scheme — `com.example.app:/callback` — is a native client's
  // other option under RFC 8252, and no web client may register one.
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  return LOOPBACK_HOSTS.has(url.hostname);
}

interface ClientRegistration {
  application_type?: unknown;
  redirect_uris?: unknown;
}

/**
 * The `application_type` a registration implies, or `undefined` to leave the
 * body as it arrived — which covers a client that said which it is, and one
 * whose redirect URIs are all ordinary https callbacks.
 *
 * One native URI is enough, as it is in SEP-837: a mixed set is ambiguous, and
 * `"native"` is the reading under which every URI in it can still be
 * registered, since the provider allows a native client ordinary https
 * redirects too.
 */
export function inferredApplicationType(body: ClientRegistration): "native" | undefined {
  if (body.application_type !== undefined) return undefined;

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris)) return undefined;

  return redirectUris.some(isNativeRedirectUri) ? "native" : undefined;
}

/**
 * The `hooks.before` middleware that applies it.
 *
 * A hook rather than a fork of the plugin: the provider offers no setting for
 * the registration default, and rewriting the request on its way in leaves
 * every one of its validations in force. Returning `{ context: { body } }` is
 * Better Auth's supported way to hand an endpoint different input.
 */
export const inferNativeClientRegistration = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== REGISTRATION_PATH) return;

  const body = ctx.body as ClientRegistration | undefined;
  if (!body) return;

  const applicationType = inferredApplicationType(body);
  if (!applicationType) return;

  return { context: { body: { ...body, application_type: applicationType } } };
});

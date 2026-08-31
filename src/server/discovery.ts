import { env } from "cloudflare:workers";
import { createAuth } from "./auth.ts";

/**
 * Serving OAuth discovery documents from the site root.
 *
 * The metadata documents are produced by the auth plugins' `onRequest` hook,
 * which Better Auth's router runs *before* it matches anything against the
 * `/api/auth` base path — so handing it a root-level request is enough, and no
 * rewriting or path juggling is needed.
 *
 * They have to live at the root because that is where the specs put them.
 * RFC 8414 and RFC 9728 both insert the identifier's path into a
 * `/.well-known/...` prefix rather than appending to the identifier, so an
 * agent looking for our authorization server asks for
 * `/.well-known/oauth-authorization-server/api/auth` — a path this app would
 * otherwise answer with the React shell and a 200, which is worse than a 404
 * because a client cannot tell it from a malformed document.
 *
 * Each discovery path gets its own route rather than a `/.well-known/*` splat:
 * that prefix is shared with everything else the web has agreed to put there,
 * and claiming all of it for the auth handler would silently shadow the next
 * thing added.
 */
export function serveDiscovery({ request }: { request: Request }): Promise<Response> {
  return createAuth(env).handler(request);
}

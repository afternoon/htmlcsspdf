import { env } from "cloudflare:workers";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "../server/auth.ts";
import { MCP_READ_SCOPE, mcpResource } from "../server/mcpResource.ts";
import { buildMcpServer } from "../server/mcpServer.ts";

/**
 * The MCP endpoint: `POST /api/mcp`.
 *
 * `requireMcpAuth` is the whole authorization story. It verifies the bearer
 * token's signature, issuer, audience and expiry against the JWKS the `jwt()`
 * plugin publishes, and answers an unauthenticated request with a 401 carrying
 * the RFC 9728 `WWW-Authenticate` header — which is how an agent discovers
 * where to authorize without being told a URL in advance.
 *
 * `resource` is passed explicitly rather than defaulted. Left off, it falls
 * back to Better Auth's base URL (`/api/auth`), and this endpoint would then
 * accept tokens minted for the authorization server itself rather than only
 * those minted for it — an audience check that passes for the wrong audience.
 *
 * Only POST is exposed. The 2026-07-28 protocol handles each request
 * independently, so there is no session to open with GET or tear down with
 * DELETE, and `legacy: "reject"` turns away 2025-era clients rather than
 * quietly serving them through a second code path.
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: ({ request }) =>
        requireMcpAuth(
          createAuth(env),
          async (authorizedRequest, claims) => {
            // The handler is built per request, closing over this token's
            // identity. Nothing about one caller can outlive their request or
            // reach another's, which is the property that matters most on a
            // shared isolate.
            const handler = createMcpHandler(
              () =>
                buildMcpServer({
                  userId: String(claims.sub),
                  scopes: grantedScopes(claims.scope),
                }),
              { legacy: "reject" },
            );

            return await handler.fetch(authorizedRequest);
          },
          {
            resource: mcpResource(env),
            // Every tool needs at least read. Write is enforced separately, by
            // which tools get registered at all — see `mcpServer.ts`.
            requiredScopes: [MCP_READ_SCOPE],
          },
        )(request),
    },
  },
});

/**
 * The token's `scope` claim, as a set.
 *
 * Space-delimited per RFC 6749. Parsed defensively: the claim is typed as
 * `unknown` by the JWT library, and a token that somehow carries no scopes at
 * all should read as "no scopes" rather than throw.
 */
function grantedScopes(scope: unknown): ReadonlySet<string> {
  return new Set(typeof scope === "string" ? scope.split(" ").filter(Boolean) : []);
}

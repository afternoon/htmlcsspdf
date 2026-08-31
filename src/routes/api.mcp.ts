import { env } from "cloudflare:workers";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "../server/auth.ts";
import { withMcpFailureResponse } from "../server/mcpFailure.ts";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, mcpResource } from "../server/mcpResource.ts";
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
      // Wrapped, because an exception escaping this route is answered by the
      // runtime as an opaque `HTTPError` with no message — see
      // `mcpFailure.ts`. Token verification in particular reaches the
      // authorization server's JWKS over HTTP, and its failures are not
      // authorization failures, so they arrive here rather than as a
      // challenge.
      POST: ({ request }) =>
        withMcpFailureResponse(() =>
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
              // What the challenge advertises, which is not the same question.
              // A spec-following client requests exactly the scopes named here
              // — the MCP SDK unions them into its authorization request and
              // never asks for more — so leaving this to default to
              // `requiredScopes` capped every agent at read-only and made the
              // write tools unreachable in practice. This names what the
              // resource offers; what it insists on is above.
              challengeScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
            },
          )(request),
        ),
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

import { appOrigin } from "./appUrl.ts";

/**
 * The MCP server's identity as an OAuth protected resource.
 *
 * Its own module because three places need to agree on it and none of them can
 * import the others: `auth.ts` binds issued tokens to it, `api.mcp.ts` demands
 * it as the token audience, and the `.well-known` routes publish it. A
 * disagreement is not a type error — it is a token that verifies everywhere
 * except the one endpoint it was minted for — so there is exactly one
 * definition.
 */

/** The path the MCP endpoint is served from. */
export const MCP_PATH = "/api/mcp";

/**
 * Scopes this resource issues.
 *
 * Split read from write so an agent that only summarises documents cannot
 * silently gain the ability to rewrite them. `offline_access` is separate
 * because it is an authorization-server concern (refresh tokens), not
 * something this resource checks — the MCP plugin filters it out of the
 * published resource metadata for that reason.
 */
export const MCP_READ_SCOPE = "documents:read";
export const MCP_WRITE_SCOPE = "documents:write";

export const MCP_SCOPES = [
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  // Without this an agent's access token expires in an hour and the user has
  // to sit through the consent screen again. Agents run unattended; that is
  // the difference between a working integration and an abandoned one.
  "offline_access",
] as const;

/**
 * The canonical resource identifier (RFC 8707).
 *
 * Derived from `BETTER_AUTH_URL` rather than configured separately, so it
 * cannot drift from the origin the app is actually served from. Must be HTTPS
 * with no query or fragment; the plugin accepts HTTP only on loopback, which
 * is what makes `http://localhost:5173/api/mcp` work in development.
 */
export function mcpResource(env: Env): string {
  return `${appOrigin(env)}${MCP_PATH}`;
}

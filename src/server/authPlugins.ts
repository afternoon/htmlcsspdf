import { mcp } from "@better-auth/mcp";
import { jwt } from "better-auth/plugins";
import { MCP_SCOPES } from "./mcpResource.ts";

/**
 * The auth plugins that own database tables.
 *
 * Separated from `auth.ts` so it can be built without a Workers runtime:
 * `auth.ts` imports `cloudflare:workers`, which nothing outside a Worker can
 * resolve, and that would put the plugin configuration out of reach of
 * `authSchema.test.ts` — the test that proves the migration still matches what
 * these plugins expect. A second, test-only copy of this list would defeat the
 * point of the test, since the copy is exactly what would drift.
 *
 * `tanstackStartCookies()` is not here: it has no schema, and it has to be the
 * last plugin in the array, which is a fact about the array rather than about
 * this list.
 */
export function authPlugins(resource: string) {
  return [
    // Access tokens are signed with a key pair kept in the `jwks` table, so
    // the MCP endpoint can verify one by signature alone rather than making a
    // database round trip per JSON-RPC call. Without this plugin the OAuth
    // provider issues opaque tokens instead, which `requireMcpAuth` cannot
    // verify.
    jwt(),
    // The MCP authorization server. It *is* the OAuth 2.1 provider — a
    // separate `oauthProvider()` alongside it is rejected — and it publishes
    // the RFC 9728 resource metadata that lets an agent discover all of this
    // starting from a bare 401.
    mcp({
      loginPage: "/login",
      consentPage: "/consent",
      resource,
      scopes: [...MCP_SCOPES],
      // Agents arrive without a client id and no human is standing by to issue
      // one in advance, so registration has to be open (RFC 7591) or the flow
      // is unusable. The alternative — Client ID Metadata Documents, where
      // identity is proven by domain ownership — needs a fetch transport that
      // resolves DNS once, rejects special-use addresses and pins the resolved
      // address for the connection. Workers exposes none of that, so CIMD
      // cannot be implemented here correctly, and implementing it incorrectly
      // would be worse than not claiming it.
      //
      // What open registration does *not* grant: registering authorises
      // nothing. Every token still comes from a person completing Google
      // sign-in and the consent screen, and is bound to that person's
      // documents alone. The consent screen is the trust boundary, which is
      // why it says the client's name is unverified.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
  ];
}

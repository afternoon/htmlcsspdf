import { createFileRoute } from "@tanstack/react-router";
import { serveDiscovery } from "../server/discovery.ts";

/**
 * RFC 8414 authorization server metadata: what the token and authorization
 * endpoints are, which grants and PKCE methods are supported, and where a
 * client registers.
 *
 * The path carries `/api/auth` because the issuer does. RFC 8414 inserts an
 * issuer's path component between the well-known prefix and the rest, so an
 * issuer of `https://host/api/auth` is described here and nowhere else. The
 * OIDC-style spelling — `/api/auth/.well-known/oauth-authorization-server` —
 * is already served by the auth catch-all, and clients try both.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server/api/auth")({
  server: { handlers: { GET: serveDiscovery, HEAD: serveDiscovery } },
});

import { createFileRoute } from "@tanstack/react-router";
import { serveDiscovery } from "../server/discovery.ts";

/**
 * RFC 9728 protected resource metadata for `/api/mcp`.
 *
 * This is the exact URL the endpoint's own 401 names in its
 * `WWW-Authenticate` header, so it is the first request an agent makes after
 * being turned away: it answers with the canonical resource identifier, the
 * scopes this resource understands, and which authorization server issues for
 * it.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/api/mcp")({
  server: { handlers: { GET: serveDiscovery, HEAD: serveDiscovery } },
});

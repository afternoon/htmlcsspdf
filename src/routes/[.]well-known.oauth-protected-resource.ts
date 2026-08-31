import { createFileRoute } from "@tanstack/react-router";
import { serveDiscovery } from "../server/discovery.ts";

/**
 * RFC 9728 protected resource metadata, at the bare well-known path.
 *
 * The path-inserted spelling that names the MCP endpoint is the one the 401
 * challenge points at, and is served by the sibling route. This one exists
 * because clients that know only the origin start here.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: { handlers: { GET: serveDiscovery, HEAD: serveDiscovery } },
});

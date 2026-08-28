import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "../server/auth.ts";

/**
 * Better Auth's catch-all endpoint: sign-in, callback, session, sign-out.
 *
 * The auth instance is built per request rather than imported from module
 * scope — the official example does the latter, but Workers only expose
 * bindings once a request is in flight.
 */
function handle({ request }: { request: Request }): Promise<Response> {
  return createAuth(env).handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});

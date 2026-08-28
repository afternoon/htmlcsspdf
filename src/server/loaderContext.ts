import { getRequest } from "@tanstack/react-start/server";
import { setRequestContext } from "../documentsApi.ts";

/**
 * Give the API client an origin and cookies while a loader runs on the server.
 *
 * Server-only, and reached from route loaders through `createServerOnlyFn` so
 * `@tanstack/react-start/server` never enters the client bundle — the build
 * rejects that import in the client graph, dynamic or not.
 */
export function adoptIncomingRequest(): void {
  const request = getRequest();
  setRequestContext({
    origin: new URL(request.url).origin,
    cookie: request.headers.get("cookie"),
  });
}

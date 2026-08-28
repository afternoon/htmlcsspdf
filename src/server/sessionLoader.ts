import { getRequest } from "@tanstack/react-start/server";
import { getSessionUser, type SessionUser } from "./session.ts";

/**
 * Resolve the signed-in user during server rendering.
 *
 * Server-only: `@tanstack/react-start/server` is rejected in the client
 * bundle, so route loaders reach this through `createServerOnlyFn`.
 */
export function loadSessionUser(): Promise<SessionUser | null> {
  return getSessionUser(getRequest());
}

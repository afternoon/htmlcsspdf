import { useRouter } from "@tanstack/react-router";
import type { SessionUser } from "./server/session.ts";

/**
 * The user resolved by the root loader during server rendering.
 *
 * Only useful before the client session store has loaded; after that the store
 * is authoritative, because it is what reacts to signing in and out.
 *
 * Returns null when there is no router — components under test render without
 * one, and a missing session is the right answer there rather than a crash.
 */
export function useServerUser(): SessionUser | null {
  const router = useRouter({ warn: false });
  const rootLoaderData = router?.state.matches[0]?.loaderData as
    | { user?: SessionUser | null }
    | undefined;
  return rootLoaderData?.user ?? null;
}

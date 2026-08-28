import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client.
 *
 * No baseURL: the client calls the same origin it was served from, which keeps
 * localhost and production working without a build-time value.
 */
export const authClient = createAuthClient();

export const { useSession, signOut } = authClient;

/**
 * Start the Google sign-in redirect.
 *
 * `callbackURL` is where Google returns the user after the round trip. It
 * defaults to the current path so a user who signed in from the editor lands
 * back in the editor with their draft, rather than somewhere generic.
 */
export function signInWithGoogle(
  callbackURL: string = window.location.pathname,
): Promise<unknown> {
  return authClient.signIn.social({ provider: "google", callbackURL });
}

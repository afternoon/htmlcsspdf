import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client.
 *
 * No baseURL: the client calls the same origin it was served from, which keeps
 * localhost and production working without a build-time value.
 *
 * The OAuth provider plugin exists for one behaviour. When the provider sends
 * a browser to `/login` or `/consent`, it appends the whole authorization
 * request to the URL, signed — the request is not parked in a cookie, so
 * echoing that query back is the only way the server can tell which request is
 * being answered. The plugin copies it onto outgoing auth calls as
 * `oauth_query`, taking care to send exactly the parameters covered by the
 * signature. Pages elsewhere are unaffected: with no signature in the URL it
 * adds nothing.
 */
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

export const { useSession, signOut } = authClient;

/**
 * Start the Google sign-in redirect.
 *
 * `callbackURL` is where Google returns the user after the round trip. It
 * defaults to the current path so a user who signed in from the editor lands
 * back in the editor with their draft, rather than somewhere generic.
 *
 * During an OAuth authorization it is a fallback rather than the destination:
 * the signed query travels to Google inside the state parameter, and the
 * provider resumes the authorization as soon as the session cookie is set —
 * sending the browser on to consent, or back to the app that asked.
 */
export function signInWithGoogle(
  callbackURL: string = window.location.pathname,
): Promise<unknown> {
  return authClient.signIn.social({ provider: "google", callbackURL });
}

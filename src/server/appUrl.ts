/**
 * URLs that point back into the app.
 *
 * The origin comes from `BETTER_AUTH_URL` rather than from the incoming
 * request. A tool call arrives at whatever hostname a proxy chose to present,
 * and a link built from that is a link that works for the proxy — while the
 * URL an agent hands its user has to be the one they can open. The same
 * variable is already the OAuth issuer and the source of the MCP resource
 * identifier, so there is one answer to "where is this app" and everything
 * derives from it.
 */

/** The path prefix the editor serves a stored document from — see `routes/d.$id.tsx`. */
const DOCUMENT_PATH = "/d/";

/** The app's origin, with any trailing slash removed. */
export function appOrigin(env: Env): string {
  return env.BETTER_AUTH_URL.replace(/\/$/, "");
}

/**
 * Where a person opens this document in a browser.
 *
 * The id is encoded even though it is a UUID we generated: the value arrives
 * here from a tool argument, and a link is not the place to trust that it
 * looks the way we expect.
 */
export function documentUrl(env: Env, id: string): string {
  return `${appOrigin(env)}${DOCUMENT_PATH}${encodeURIComponent(id)}`;
}

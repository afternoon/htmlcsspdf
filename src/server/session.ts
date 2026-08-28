import { env } from "cloudflare:workers";
import { createAuth } from "./auth.ts";

/**
 * Resolving the signed-in user on the server.
 *
 * Every document route needs the same two things: who is asking, and a 401 if
 * nobody is. Keeping both here means a route cannot accidentally read a
 * document without having established an owner first.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  const { id, email, name, image } = session.user;
  return { id, email, name, image };
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Run `handler` with the signed-in user, or answer 401.
 *
 * Routes take the user as an argument rather than looking it up themselves, so
 * "am I signed in?" is answered once, before any query runs.
 */
export async function withUser(
  request: Request,
  handler: (user: SessionUser) => Promise<Response>,
): Promise<Response> {
  const user = await getSessionUser(request);
  if (!user) return jsonError(401, "Sign in to continue.");
  return await handler(user);
}

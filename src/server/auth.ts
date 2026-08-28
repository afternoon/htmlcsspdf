import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

/**
 * Better Auth, built per request.
 *
 * Not a module-level singleton: Workers forbid I/O at global scope, so the D1
 * binding is only reachable once a request is in flight. A singleton would also
 * capture the first request's `waitUntil` and hand it to every later request,
 * attaching background work to a context that has already ended.
 */
export function createAuth(env: Env, ctx?: ExecutionContext) {
  return betterAuth({
    // Passed straight through: Better Auth duck-types a D1Database and selects
    // its own D1 dialect, so no ORM or adapter sits in between.
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    // Explicit, because a wrong value here surfaces as an OAuth redirect_uri
    // mismatch from Google rather than as an error from us.
    baseURL: env.BETTER_AUTH_URL,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    advanced: {
      // Better Auth defers non-critical work (cleanup, timing-attack
      // mitigation) until after the response is sent. Without a handler the
      // isolate can be torn down before that work runs.
      ...(ctx ? { backgroundTasks: { handler: (p) => ctx.waitUntil(p) } } : {}),
    },
    // Must be last: the plugin warns at runtime if another plugin follows it.
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

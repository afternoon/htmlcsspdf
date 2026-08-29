import { waitUntil } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

/**
 * Better Auth, built per request.
 *
 * Not a module-level singleton: Workers forbid I/O at global scope, so the D1
 * binding is only reachable once a request is in flight.
 */
export function createAuth(env: Env) {
  return betterAuth({
    // Passed straight through: Better Auth duck-types a D1Database and selects
    // its own D1 dialect, so no ORM or adapter sits in between.
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    // Explicit, because a wrong value here surfaces as an OAuth redirect_uri
    // mismatch from Google rather than as an error from us.
    baseURL: env.BETTER_AUTH_URL,
    // Defaults to baseURL, so this changes nothing today — it states the CSRF
    // boundary rather than leaving it implicit in another setting.
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    advanced: {
      // Better Auth defers non-critical work — cleanup, timing-attack
      // mitigation — until after the response is sent, and a Worker isolate can
      // be torn down the moment it responds. `waitUntil` from
      // `cloudflare:workers` is module-scoped and resolves the in-flight
      // request's context, so it needs no ExecutionContext threaded through:
      // an earlier version took one as an argument, no caller ever passed it,
      // and the handler was silently never installed.
      backgroundTasks: { handler: waitUntil },
    },
    // Must be last: the plugin warns at runtime if another plugin follows it.
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

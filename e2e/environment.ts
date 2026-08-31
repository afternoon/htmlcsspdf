import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the end-to-end run gets its configuration.
 *
 * Shared by the Vite config that starts the server and by the test that talks
 * to it, because the two have to agree exactly: the test signs a session
 * cookie with `BETTER_AUTH_SECRET`, and the server verifies it.
 *
 * The port is fixed rather than chosen at random. `BETTER_AUTH_URL` carries it,
 * and that URL becomes the OAuth issuer and the MCP resource identifier — the
 * audience every access token is bound to. A server on a different port than
 * the one in its own configuration would issue tokens its own endpoint refuses.
 */

export const E2E_PORT = 5173;

/**
 * Fallback variables, used when there is no `.dev.vars` — which is the case in
 * CI. Wrangler layers `.dev.vars` over a Worker's `vars`, so a contributor who
 * has one runs against theirs instead, and `readVars` below resolves in the
 * same order.
 *
 * The secret is a fixed, published string. That is fine and slightly
 * deliberate: it signs cookies for a throwaway local database, and a test that
 * generated a random one could not tell you why it failed when the server
 * disagreed. Google's credentials are placeholders — the flow under test never
 * reaches Google.
 */
export const E2E_VARS = {
  BETTER_AUTH_SECRET: "e2e-secret-not-used-outside-tests-0000000000",
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  GOOGLE_CLIENT_ID: "e2e-unused",
  GOOGLE_CLIENT_SECRET: "e2e-unused",
} as const;

/** Minimal `.dev.vars` reader: `KEY="value"` or `KEY=value`, `#` comments. */
function parseDevVars(source: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    vars[match[1]] = (match[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1");
  }
  return vars;
}

/**
 * The variables the server will actually run with.
 *
 * Mirrors Wrangler's own precedence — `.dev.vars` wins over configured `vars` —
 * so the test resolves the same values the Worker does rather than assuming
 * the fallbacks are in force. An empty value in `.dev.vars` is treated as
 * absent, which is what a half-filled copy of `.dev.vars.example` looks like.
 */
export function readVars(): Record<string, string> {
  const path = join(process.cwd(), ".dev.vars");
  if (!existsSync(path)) return { ...E2E_VARS };

  const fromFile = parseDevVars(readFileSync(path, "utf8"));
  const resolved: Record<string, string> = { ...E2E_VARS };
  for (const [key, value] of Object.entries(fromFile)) {
    if (value) resolved[key] = value;
  }
  return resolved;
}

/** The origin the app is served from, per its own configuration. */
export function baseUrl(): string {
  return readVars().BETTER_AUTH_URL ?? E2E_VARS.BETTER_AUTH_URL;
}

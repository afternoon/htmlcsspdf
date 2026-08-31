import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import type { TestProject } from "vitest/node";
import { baseUrl, E2E_PORT, readVars } from "./environment.ts";

/**
 * Brings up the real app for the end-to-end run.
 *
 * The server is the actual dev server, so the code under test is served by
 * workerd through the Cloudflare plugin — the same runtime production uses,
 * reached over real HTTP. Nothing here stubs the app.
 *
 * Two people are created before the server starts rather than through it,
 * because there is no way in: sign-in goes through Google, which a test cannot
 * drive. Writing the session row directly and signing the cookie ourselves
 * substitutes for exactly that step and nothing more — everything downstream,
 * the whole OAuth and MCP exchange, is the real thing.
 */

/** Random per run, so a shared local database never leaks state between runs. */
function personId(name: string): string {
  return `e2e-${name}-${crypto.randomUUID()}`;
}

/**
 * Better Auth's session cookie: the token, then an HMAC of it, URL-encoded.
 *
 * Matches `signCookieValue` in better-call — base64 (not base64url) of
 * HMAC-SHA256 over the raw token, joined to it with a dot.
 */
function sessionCookie(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

function d1(command: string, args: string[]): void {
  const result = spawnSync("bunx", ["wrangler", "d1", ...args, "htmlcsspdf", "--local"], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_LOG: "error" },
  });

  if (result.status !== 0) {
    throw new Error(`wrangler d1 ${command} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Wait for the server to answer, or give up with something diagnosable. */
async function waitForServer(url: string, log: () => string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      // Any answer means the server is listening; the status does not matter.
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start within 90s. Output:\n${log()}`);
}

export default async function setup(project: TestProject) {
  const vars = readVars();
  const secret = vars.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is missing.");

  // Idempotent, and the only way to be sure the OAuth tables exist: a
  // contributor may never have applied 0004, and CI starts from nothing.
  d1("migrations apply", ["migrations", "apply"]);

  const alice = personId("alice");
  const bob = personId("bob");
  const aliceToken = crypto.randomUUID();
  const bobToken = crypto.randomUUID();

  const rows = [alice, bob]
    .map((id, index) => {
      const token = index === 0 ? aliceToken : bobToken;
      return (
        `insert into "user" ("id","name","email","emailVerified","createdAt","updatedAt") ` +
        `values ('${id}', '${id}', '${id}@e2e.test', 1, datetime('now'), datetime('now'));` +
        `insert into "session" ("id","expiresAt","token","createdAt","updatedAt","userId") ` +
        `values ('${id}-session', datetime('now','+1 day'), '${token}', datetime('now'), datetime('now'), '${id}');`
      );
    })
    .join("");
  d1("execute", ["execute", "--command", rows]);

  const output: string[] = [];
  const server = spawn(
    "bunx",
    ["vite", "dev", "--config", "e2e/vite.config.ts", "--port", String(E2E_PORT)],
    {
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  const url = baseUrl();
  try {
    await waitForServer(url, () => output.join(""));
  } catch (cause) {
    server.kill("SIGTERM");
    throw cause;
  }

  project.provide("e2e", {
    baseUrl: url,
    alice: { userId: alice, cookie: sessionCookie(aliceToken, secret) },
    bob: { userId: bob, cookie: sessionCookie(bobToken, secret) },
  });

  return () => {
    server.kill("SIGTERM");
  };
}

export interface E2EContext {
  baseUrl: string;
  alice: { userId: string; cookie: string };
  bob: { userId: string; cookie: string };
}

declare module "vitest" {
  interface ProvidedContext {
    e2e: E2EContext;
  }
}

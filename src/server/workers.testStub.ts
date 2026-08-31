/**
 * Stands in for `cloudflare:workers` under vitest.
 *
 * That module only exists inside the Workers runtime, so anything importing it
 * — `mcpServer.ts` among them — is unloadable in a test without this. Aliased
 * in `vitest.config.ts`; nothing in the app imports it directly.
 *
 * `env` is mutable so a test can install its own bindings, and `waitUntil`
 * keeps what it is handed rather than discarding it, so a test can await the
 * background work a request kicked off instead of racing it.
 */

export const env = {} as Env & Record<string, unknown>;

export const scheduled: Promise<unknown>[] = [];

export function waitUntil(promise: Promise<unknown>): void {
  scheduled.push(promise);
}

/** Forget bindings and pending work between tests. */
export function resetWorkersStub(): void {
  for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key];
  scheduled.length = 0;
}

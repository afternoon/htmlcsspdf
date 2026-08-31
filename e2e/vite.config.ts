import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { E2E_PORT, E2E_VARS } from "./environment.ts";

/**
 * The app, configured for an end-to-end run.
 *
 * Identical to the root config except for the variables. Wrangler layers
 * `.dev.vars` *over* a Worker's configured `vars`, so these are fallbacks: a
 * contributor with a real `.dev.vars` runs against their own values, and CI,
 * which has none, runs against these. `environment.ts` resolves the same way,
 * so the test and the server always agree on the secret — which matters,
 * because the test signs a session cookie with it.
 *
 * `strictPort` is deliberate. The port is baked into `BETTER_AUTH_URL`, and
 * therefore into the OAuth issuer and the MCP resource identifier, so a server
 * that quietly moved to the next free port would mint tokens for an audience
 * the endpoint rejects — a confusing failure a long way from its cause.
 * Failing to bind says what actually went wrong: something is already on 5173.
 */
export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      config: { vars: E2E_VARS },
    }),
    tanstackStart(),
    react({ compiler: true }),
  ],
  server: { port: E2E_PORT, strictPort: true },
});

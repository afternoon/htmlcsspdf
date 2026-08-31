import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `cloudflare:workers` resolves only inside the Workers runtime, so a
      // test importing any server module that uses it fails at load. The stub
      // gives those modules an `env` a test can fill in and a `waitUntil` that
      // keeps its promises instead of dropping them.
      "cloudflare:workers": fileURLToPath(
        new URL("./src/server/workers.testStub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

import { defineConfig } from "vitest/config";

/**
 * The end-to-end suite, kept apart from the unit tests.
 *
 * Its own config rather than a project in `vitest.config.ts`, because almost
 * nothing is shared: these run against a real server on a real port, so they
 * need the node environment, no jsdom setup, no parallelism, and timeouts
 * measured in seconds rather than milliseconds.
 *
 * `globalSetup` owns the server. One instance serves the whole file, and the
 * suite is single-threaded, because the app is a single origin with one
 * database — two files racing on it would flake for reasons that have nothing
 * to do with the code.
 */
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./e2e/globalSetup.ts"],
    fileParallelism: false,
    // Booting workerd and running a full OAuth round trip is not a millisecond
    // affair, and a cold Vite start is slower still.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

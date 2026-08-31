import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plugin order matters: cloudflare() binds the SSR environment to workerd,
// tanstackStart() generates the route tree, react() handles JSX.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      // Tests live beside what they test, `src/routes/` included. They export
      // no Route, so the generator warns about each one and leaves it out of
      // the tree — which is right, but the warning reads like a mistake. This
      // says up front that a `*.test.ts(x)` file is never a route. Matched
      // against the bare filename, not the path.
      router: { routeFileIgnorePattern: "\\.test\\.tsx?$" },
    }),
    react({
      // The React Compiler memoises automatically, and more precisely than
      // hand-written dependency arrays, so components are written without
      // memo/useMemo/useCallback and rely on this being on.
      //
      // `compiler`, not `babel.plugins`: on Vite 8 this plugin transforms with
      // oxc and only reaches for Babel when asked. Passing the plugin through
      // `babel` instead is accepted silently and does nothing at all.
      compiler: true,
    }),
  ],
});

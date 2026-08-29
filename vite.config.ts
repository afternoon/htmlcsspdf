import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plugin order matters: cloudflare() binds the SSR environment to workerd,
// tanstackStart() generates the route tree, react() handles JSX.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
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

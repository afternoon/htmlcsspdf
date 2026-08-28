import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import type { SessionUser } from "../server/session.ts";
import styles from "../styles.css?url";

/**
 * Resolve the session on the server so the header renders signed-in on first
 * paint. Returns null in the browser, where the client session store — which
 * stays authoritative after hydration — already has the answer.
 */
const loadSession = createServerOnlyFn(async (): Promise<SessionUser | null> => {
  const { loadSessionUser } = await import("../server/sessionLoader.ts");
  return await loadSessionUser();
});

/**
 * SSR is on, so /docs and the header resolve the session before HTML is sent
 * rather than flashing a signed-out state.
 *
 * The editor is safe to render on the server: CodeMirror mounts in an effect,
 * and content comes from route data with localStorage read lazily behind a
 * `useState` initialiser that only runs in the browser.
 */
export const Route = createRootRoute({
  loader: async (): Promise<{ user: SessionUser | null }> => ({
    user: (await loadSession()) ?? null,
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "htmlcsspdf" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  ),
  component: Outlet,
});

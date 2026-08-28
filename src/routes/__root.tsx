import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SessionUser } from "../server/session.ts";
import styles from "../styles.css?url";

/**
 * Resolve the session on the server so the header renders signed-in on first
 * paint, rather than flashing a signed-out state.
 *
 * A server function, not a server-*only* one: the root loader also runs on
 * every client-side navigation, and `createServerOnlyFn` throws in the browser.
 * After hydration the client session store is authoritative anyway, so this
 * only matters for the first render.
 */
const loadSession = createServerFn().handler(async (): Promise<SessionUser | null> => {
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

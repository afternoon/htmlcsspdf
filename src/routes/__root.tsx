import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import styles from "../styles.css?url";

/**
 * SSR is on, so /docs and the header resolve the session before HTML is sent
 * rather than flashing a signed-out state.
 *
 * The editor is safe to render on the server: CodeMirror mounts in an effect,
 * and content comes from route data with localStorage read lazily behind a
 * `useState` initialiser that only runs in the browser.
 */
export const Route = createRootRoute({
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

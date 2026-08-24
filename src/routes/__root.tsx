import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import styles from "../styles.css?url";

/**
 * The shell is the only thing rendered on the server. Everything below it is
 * client-only: the editors build CodeMirror views against real DOM nodes, and
 * the document/layout state is read from localStorage during render.
 */
export const Route = createRootRoute({
  ssr: false,
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

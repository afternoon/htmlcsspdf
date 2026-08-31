import { createFileRoute } from "@tanstack/react-router";
import { ConsentPage } from "../ConsentPage.tsx";

/**
 * `/consent` — where the OAuth provider sends a signed-in browser to decide.
 *
 * The provider puts `client_id`, `scope` and `code` in the query string. Only
 * the first two are read: the request being answered is identified by the
 * session cookie, not by anything this page could be handed, so a link
 * carrying someone else's code approves nothing.
 */
export const Route = createFileRoute("/consent")({
  validateSearch: (search: Record<string, unknown>) => ({
    client_id: typeof search.client_id === "string" ? search.client_id : "",
    scope: typeof search.scope === "string" ? search.scope : "",
  }),
  component: ConsentRoute,
});

function ConsentRoute() {
  const { client_id, scope } = Route.useSearch();

  // Reached without a pending request — someone opened /consent directly.
  // There is nothing to approve, so say so rather than rendering an empty
  // approval screen with live buttons.
  if (!client_id) {
    return (
      <div className="page">
        <main className="page-body">
          <div className="empty">
            <h1>Nothing to approve</h1>
            <p>This page appears during an app's sign-in, not on its own.</p>
            <a href="/" className="button-link">
              Back to the editor
            </a>
          </div>
        </main>
      </div>
    );
  }

  return <ConsentPage clientId={client_id} scope={scope} />;
}

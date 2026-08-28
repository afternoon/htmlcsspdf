import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { App } from "../App.tsx";
import { fetchDocument } from "../documentsApi.ts";

/**
 * On the server the API client has no origin or cookie jar of its own, so the
 * loader hands it the in-flight request. A no-op in the browser, where both
 * are ambient.
 */
const adoptRequest = createServerOnlyFn(async () => {
  const { adoptIncomingRequest } = await import("../server/loaderContext.ts");
  adoptIncomingRequest();
});

/**
 * An existing document, opened in the editor.
 *
 * The same editor as `/`, seeded from the stored document rather than from the
 * sample — so Save updates in place instead of asking for a name again.
 */
export const Route = createFileRoute("/d/$id")({
  loader: async ({ params }) => {
    await adoptRequest();
    return await fetchDocument(params.id);
  },
  component: DocumentEditor,
  errorComponent: DocumentError,
});

function DocumentEditor() {
  const document = Route.useLoaderData();
  return (
    <App
      documentId={document.id}
      documentName={document.name}
      initialContent={{ html: document.html, css: document.css }}
    />
  );
}

function DocumentError({ error }: { error: Error }) {
  return (
    <div className="page">
      <div className="empty">
        <h1>Could not open this document</h1>
        <p>{error.message}</p>
        <a href="/docs" className="button-link">
          Back to documents
        </a>
      </div>
    </div>
  );
}

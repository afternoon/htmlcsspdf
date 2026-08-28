import { createFileRoute } from "@tanstack/react-router";
import { App } from "../App.tsx";
import { fetchDocument } from "../documentsApi.ts";

/**
 * An existing document, opened in the editor.
 *
 * The same editor as `/`, seeded from the stored document rather than from the
 * sample — so Save updates in place instead of asking for a name again.
 */
export const Route = createFileRoute("/d/$id")({
  loader: ({ params }) => fetchDocument(params.id),
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

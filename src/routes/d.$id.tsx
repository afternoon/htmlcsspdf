import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { App } from "../App.tsx";
import type { DocumentDetail } from "../documentsApi.ts";
import { SignedOut } from "../SignedOut.tsx";

/** Read from D1 directly; see the note in routes/docs.tsx. */
const loadDocument = createServerFn()
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }): Promise<DocumentDetail | null | undefined> => {
    const { loadDocumentForRequest } = await import("../server/loaderData.ts");
    return (await loadDocumentForRequest(id)) as DocumentDetail | null | undefined;
  });

/**
 * An existing document, opened in the editor.
 *
 * The same editor as `/`, seeded from the stored document rather than from the
 * sample — so Save updates in place instead of asking for a name again.
 */
export const Route = createFileRoute("/d/$id")({
  loader: async ({ params }) => {
    const document = await loadDocument({ data: params.id });
    // undefined means the document does not exist, or belongs to someone else;
    // the two are deliberately indistinguishable.
    if (document === undefined) throw notFound();
    return document;
  },
  component: DocumentEditor,
  notFoundComponent: DocumentNotFound,
  errorComponent: DocumentError,
});

function DocumentEditor() {
  const document = Route.useLoaderData();
  if (!document) return <SignedOut />;

  return (
    <App
      documentId={document.id}
      documentName={document.name}
      initialContent={{ html: document.html, css: document.css }}
    />
  );
}

function DocumentNotFound() {
  return (
    <div className="page">
      <div className="empty">
        <h1>Document not found</h1>
        <p>It may have been deleted, or it belongs to another account.</p>
        <a href="/docs" className="button-link">
          Back to documents
        </a>
      </div>
    </div>
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

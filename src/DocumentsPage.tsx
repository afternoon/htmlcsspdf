import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AccountMenu } from "./AccountMenu.tsx";
import { DocumentCard } from "./DocumentCard.tsx";
import type { DocumentSummary } from "./documentsApi.ts";
import * as api from "./documentsApi.ts";
import { NameDialog } from "./NameDialog.tsx";
import { Route } from "./routes/docs.tsx";

/** The document list: header, a New document action, and a grid of cards. */
export function DocumentsPage() {
  const documents = Route.useLoaderData();
  const router = useRouter();
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRename(name: string) {
    if (!renaming) return;
    const target = renaming;
    setRenaming(null);
    try {
      await api.renameDocument(target.id, name);
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the document.");
    }
  }

  async function handleDelete(document: DocumentSummary) {
    // Deleting is destructive and there is no undo, so confirm first.
    if (!window.confirm(`Delete “${document.name}”? This cannot be undone.`)) return;
    try {
      await api.deleteDocument(document.id);
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the document.");
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Link to="/" className="brand-link">
            htmlcsspdf
          </Link>
          <span className="status">documents</span>
        </div>
        <div className="actions">
          <AccountMenu onSignIn={() => router.navigate({ to: "/" })} />
          <Link to="/" className="button-link">
            New document
          </Link>
        </div>
      </header>

      <main className="page-body">
        {/* Live region stays mounted so failures are announced when they land. */}
        <div role="alert" className="page-error" hidden={!error}>
          {error}
        </div>

        {documents.length === 0 ? (
          <div className="empty">
            <h1>No documents yet</h1>
            <p>Documents you save will appear here.</p>
            <Link to="/" className="button-link">
              New document
            </Link>
          </div>
        ) : (
          <ul className="doc-grid">
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                onRename={setRenaming}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </main>

      <NameDialog
        open={renaming !== null}
        initialName={renaming?.name ?? ""}
        title="Rename document"
        submitLabel="Rename"
        onSubmit={handleRename}
        onClose={() => setRenaming(null)}
      />
    </div>
  );
}

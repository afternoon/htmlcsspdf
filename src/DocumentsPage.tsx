import { Link, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "./AppShell.tsx";
import { DocumentCard } from "./DocumentCard.tsx";
import { DropZone } from "./DropZone.tsx";
import type { DocumentSummary } from "./documentsApi.ts";
import * as api from "./documentsApi.ts";
import { readDrop } from "./dropFiles.ts";
import { Toast } from "./Toast.tsx";
import { useToast } from "./useToast.ts";

/** The document list: header, a New document action, and a grid of cards. */
export function DocumentsPage({ documents }: { documents: DocumentSummary[] }) {
  const router = useRouter();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: nothing renders differently while a document is being
  // created, and two drops in one tick would both read a stale `useState`.
  const creating = useRef(false);
  const toast = useToast();

  async function handleRename(document: DocumentSummary, name: string) {
    setRenamingId(document.id);
    try {
      await api.renameDocument(document.id, name);
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the document.");
    } finally {
      setRenamingId(null);
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

  /**
   * Create a document from dropped files, and open it.
   *
   * The list has nothing to overwrite, so a drop here is a new document: one
   * file fills its pane and leaves the other empty, two fill both. It is named
   * after the file rather than "Untitled", since the name is right there and
   * renaming is the first thing anyone would otherwise do.
   *
   * The editor is opened afterwards, the same as saving a new document does —
   * a card appearing in a grid is a thin result for having dropped a file.
   */
  async function handleDrop(files: File[]) {
    // A second drop while the first is still in flight would create two
    // documents and navigate to whichever finished last. Claimed before the
    // first await, so two drops in quick succession cannot both get past it.
    if (creating.current) return;
    creating.current = true;

    try {
      const result = await readDrop(files);
      if (!result.ok) {
        toast.show(result.error);
        return;
      }

      const id = await api.createDocument({
        name: result.content.name,
        html: result.content.html ?? "",
        css: result.content.css ?? "",
      });
      await router.navigate({ to: "/d/$id", params: { id } });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not create the document.");
    } finally {
      creating.current = false;
    }
  }

  return (
    <>
      <DropZone
        onDrop={(files) => void handleDrop(files)}
        hint="Drop HTML or CSS files to start a document"
      />
      <Toast toast={toast.toast} onDismiss={toast.dismiss} />

      <AppShell
        title={<span className="status">documents</span>}
        onSignIn={() => router.navigate({ to: "/" })}
        actions={
          <Link to="/" className="button-link">
            New document
          </Link>
        }
      >
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
                  onRename={handleRename}
                  onDelete={handleDelete}
                  renaming={renamingId === document.id}
                />
              ))}
            </ul>
          )}
        </main>
      </AppShell>
    </>
  );
}

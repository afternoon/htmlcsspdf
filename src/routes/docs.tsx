import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "../DocumentsPage.tsx";
import { fetchDocuments } from "../documentsApi.ts";

/**
 * The document list.
 *
 * Loaded through the router's own loader rather than a query library: the app
 * has one list and one detail view, so the router's cache and invalidation are
 * enough, and TanStack Query would be a dependency earning very little here.
 */
export const Route = createFileRoute("/docs")({
  loader: () => fetchDocuments(),
  component: DocumentsPage,
  errorComponent: DocumentsError,
});

function DocumentsError({ error }: { error: Error }) {
  // Most likely cause by far is being signed out, so lead with that.
  return (
    <div className="page">
      <div className="empty">
        <h1>Could not load your documents</h1>
        <p>{error.message}</p>
        <a href="/docs" className="button-link">
          Try again
        </a>
      </div>
    </div>
  );
}

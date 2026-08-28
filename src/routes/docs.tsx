import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { DocumentsPage } from "../DocumentsPage.tsx";
import type { DocumentSummary } from "../documentsApi.ts";
import { SignedOut } from "../SignedOut.tsx";

/**
 * Read from D1 directly rather than over HTTP.
 *
 * The loader runs in the same isolate as the API routes, so fetching
 * `/api/documents` would be a network round trip to reach code next door — and
 * a Worker's request to its own hostname does not reliably come back to
 * itself.
 */
const loadDocuments = createServerOnlyFn(async (): Promise<DocumentSummary[] | null> => {
  const { loadDocumentsForRequest } = await import("../server/loaderData.ts");
  return await loadDocumentsForRequest();
});

/**
 * The document list.
 *
 * Loaded through the router's own loader rather than a query library: the app
 * has one list and one detail view, so the router's cache and invalidation are
 * enough, and TanStack Query would be a dependency earning very little here.
 */
export const Route = createFileRoute("/docs")({
  // null means signed out, which is an ordinary state rather than a failure —
  // so it renders an invitation to sign in with a normal status, not a 500.
  loader: async () => (await loadDocuments()) ?? null,
  component: DocumentsRoute,
  errorComponent: DocumentsError,
});

function DocumentsRoute() {
  // The route owns the loader and hands data down, rather than the page
  // reaching back for it — importing the route from the component would make
  // the two modules circular, which breaks server rendering.
  const documents = Route.useLoaderData();
  if (!documents) return <SignedOut />;
  return <DocumentsPage documents={documents} />;
}

function DocumentsError({ error }: { error: Error }) {
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

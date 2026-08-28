import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { DocumentsPage } from "../DocumentsPage.tsx";
import { ApiError, fetchDocuments } from "../documentsApi.ts";
import { SignedOut } from "../SignedOut.tsx";

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
 * The document list.
 *
 * Loaded through the router's own loader rather than a query library: the app
 * has one list and one detail view, so the router's cache and invalidation are
 * enough, and TanStack Query would be a dependency earning very little here.
 */
export const Route = createFileRoute("/docs")({
  loader: async () => {
    await adoptRequest();
    try {
      return await fetchDocuments();
    } catch (error) {
      // Being signed out is an ordinary state, not a server fault: answer 200
      // with an invitation to sign in rather than a 500 the visitor cannot act
      // on. Anything else is a real error and belongs in the boundary.
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
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
  // Being signed out is the ordinary case here, not a failure: someone
  // following a link to /docs without a session should be invited in rather
  // than shown an error they cannot act on.
  if (error instanceof ApiError && error.status === 401) return <SignedOut />;

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

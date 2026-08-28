import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";
import type { DocumentRecord, DocumentSummary } from "./documents.ts";
import { listDocuments, loadDocument } from "./documents.ts";
import { getSessionUser } from "./session.ts";

/**
 * Loader data, read straight from D1.
 *
 * Server rendering runs in the same isolate as the API routes, so a loader
 * that fetched `/api/documents` over HTTP would be making a network round trip
 * to reach code it could call directly — and on Workers a request to the
 * worker's own hostname does not reliably loop back to itself, which is how
 * this first showed up: 404 in production, fine in local dev.
 *
 * Server-only. Route loaders reach these through `createServerOnlyFn` so
 * `cloudflare:workers` never enters the client bundle.
 */

/** Null when signed out, so the caller can offer sign-in rather than an error. */
export async function loadDocumentsForRequest(): Promise<DocumentSummary[] | null> {
  const user = await getSessionUser(getRequest());
  if (!user) return null;
  return await listDocuments(env.DB, user.id);
}

/**
 * Null when signed out; undefined when the document is absent or owned by
 * someone else — the two are indistinguishable on purpose.
 */
export async function loadDocumentForRequest(
  id: string,
): Promise<DocumentRecord | null | undefined> {
  const user = await getSessionUser(getRequest());
  if (!user) return null;
  return (await loadDocument(env.DB, id, user.id)) ?? undefined;
}

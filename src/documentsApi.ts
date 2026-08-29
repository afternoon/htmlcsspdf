import { z } from "zod";
import { MAX_NAME_LENGTH } from "./documentName.ts";

/**
 * The document API contract, and the client half of it.
 *
 * The schemas are the single definition of the wire format: the server parses
 * requests with them and the client parses responses with them, so the two
 * cannot drift. Responses are parsed rather than cast — our own API can be an
 * older deploy, which makes it an untrusted source like any other.
 *
 * These functions run in the browser only. Server rendering reads D1 directly
 * (see server/loaderData.ts) rather than calling this API over HTTP.
 */

export const DocumentNameSchema = z
  .string()
  .trim()
  .min(1, "Give the document a name.")
  .max(MAX_NAME_LENGTH, `Keep the name under ${MAX_NAME_LENGTH} characters.`);

/**
 * Largest accepted HTML or CSS pane.
 *
 * Matches the render endpoint's own limit, so a document can never be saved
 * that is too large to turn into a PDF. It also bounds the sanitiser's work:
 * parsing is superlinear on pathological input, and an uncapped body was a
 * denial-of-service vector as well as an unrenderable document.
 */
export const MAX_CONTENT_BYTES = 2_000_000;

const DocumentBody = z
  .string()
  .max(MAX_CONTENT_BYTES, "Document is too large — keep HTML and CSS under 2 MB each.");

export const SaveDocumentSchema = z.object({
  name: DocumentNameSchema,
  html: DocumentBody,
  css: DocumentBody,
});
export type SaveDocumentInput = z.infer<typeof SaveDocumentSchema>;

export const UpdateDocumentSchema = z.object({
  html: DocumentBody,
  css: DocumentBody,
});

export const RenameDocumentSchema = z.object({ name: DocumentNameSchema });

export const DocumentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  thumbnailUpdatedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentSchema = DocumentSummarySchema.extend({
  html: z.string(),
  css: z.string(),
});
export type DocumentDetail = z.infer<typeof DocumentSchema>;

const DocumentListSchema = z.object({ documents: z.array(DocumentSummarySchema) });
const CreatedSchema = z.object({ id: z.string() });

/** Thrown for a non-OK response, carrying the status so callers can branch. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function resolveRequest(
  path: string,
  init?: RequestInit,
): { url: string; init: RequestInit } {
  return {
    url: path,
    init: { ...init, headers: { "content-type": "application/json", ...init?.headers } },
  };
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const resolved = resolveRequest(path, init);
  const response = await fetch(resolved.url, resolved.init);

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => (body as { error?: string }).error)
      .catch(() => undefined);
    throw new ApiError(
      response.status,
      message ?? `Request failed (${response.status}).`,
    );
  }

  return response.status === 204 ? null : await response.json();
}

export async function fetchDocuments(): Promise<DocumentSummary[]> {
  return DocumentListSchema.parse(await request("/api/documents")).documents;
}

export async function fetchDocument(id: string): Promise<DocumentDetail> {
  return DocumentSchema.parse(await request(`/api/documents/${id}`));
}

export async function createDocument(input: SaveDocumentInput): Promise<string> {
  const body = JSON.stringify(SaveDocumentSchema.parse(input));
  return CreatedSchema.parse(await request("/api/documents", { method: "POST", body }))
    .id;
}

export async function saveDocument(id: string, html: string, css: string): Promise<void> {
  await request(`/api/documents/${id}`, {
    method: "PUT",
    body: JSON.stringify(UpdateDocumentSchema.parse({ html, css })),
  });
}

export async function renameDocument(id: string, name: string): Promise<void> {
  await request(`/api/documents/${id}/name`, {
    method: "PUT",
    body: JSON.stringify(RenameDocumentSchema.parse({ name })),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/api/documents/${id}`, { method: "DELETE" });
}

/**
 * Where a document's thumbnail is served from; always through the worker.
 *
 * Takes the capture timestamp rather than allowing null: callers only render an
 * image once one exists, and the version parameter is what makes the response
 * safe to cache immutably.
 */
export function thumbnailUrl(id: string, capturedAt: number): string {
  return `/api/documents/${id}/thumbnail?v=${capturedAt}`;
}

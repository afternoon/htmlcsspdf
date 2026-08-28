import { sanitizeHtml } from "../sanitize.ts";

/**
 * Document storage.
 *
 * Every query in this module takes a `userId` and folds it into the WHERE
 * clause. That is deliberate and load-bearing: there is no exported function
 * that can read or write a document without naming its owner, so a new caller
 * cannot forget an ownership check it was never able to skip. Access control
 * is the query, not a separate step a route has to remember.
 *
 * Content lives in D1 alongside the metadata rather than in object storage. A
 * document is two text fields, so one row is the whole thing — no second write
 * to keep consistent, and nothing to leak from a bucket.
 */

export interface DocumentRecord {
  id: string;
  userId: string;
  name: string;
  html: string;
  css: string;
  /** Epoch ms of the last successful thumbnail capture; null if there is none. */
  thumbnailUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** What the document list needs. Content is excluded: a list never renders it. */
export interface DocumentSummary {
  id: string;
  name: string;
  thumbnailUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentContent {
  html: string;
  css: string;
}

export interface NewDocument extends DocumentContent {
  name: string;
}

/** Longest accepted document name, matching what the UI allows. */
export const MAX_NAME_LENGTH = 200;

/** Fallback for a document saved without a usable name. */
const DEFAULT_NAME = "Untitled document";

/**
 * Normalise a user-supplied name: collapse whitespace, trim, cap the length,
 * and fall back when nothing usable remains.
 */
export function normalizeName(name: string): string {
  const collapsed = name.replace(/\s+/g, " ").trim();
  if (!collapsed) return DEFAULT_NAME;
  return collapsed.slice(0, MAX_NAME_LENGTH);
}

export async function createDocument(
  db: D1Database,
  userId: string,
  input: NewDocument,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `insert into "document"
         ("id","userId","name","html","css","thumbnailUpdatedAt","createdAt","updatedAt")
       values (?, ?, ?, ?, ?, null, ?, ?)`,
    )
    // Sanitised on the way in, so nothing executable is ever at rest — even if
    // a future caller forgets. The editor's own check is only advisory.
    .bind(
      id,
      userId,
      normalizeName(input.name),
      sanitizeHtml(input.html),
      input.css,
      now,
      now,
    )
    .run();

  return { id };
}

/** The document, or null when it does not exist *or* belongs to someone else. */
export async function loadDocument(
  db: D1Database,
  id: string,
  userId: string,
): Promise<DocumentRecord | null> {
  return await db
    .prepare(`select * from "document" where "id" = ? and "userId" = ?`)
    .bind(id, userId)
    .first<DocumentRecord>();
}

export async function listDocuments(
  db: D1Database,
  userId: string,
): Promise<DocumentSummary[]> {
  const { results } = await db
    .prepare(
      `select "id","name","thumbnailUpdatedAt","createdAt","updatedAt"
       from "document" where "userId" = ? order by "updatedAt" desc`,
    )
    .bind(userId)
    .all<DocumentSummary>();

  return results ?? [];
}

/** True if the update applied; false if no document matched the owner and id. */
export async function updateDocument(
  db: D1Database,
  id: string,
  userId: string,
  content: DocumentContent,
): Promise<boolean> {
  const result = await db
    .prepare(
      // The thumbnail is cleared because it depicts content that no longer
      // exists. A card showing a stale preview is worse than one showing none.
      `update "document"
         set "html" = ?, "css" = ?, "updatedAt" = ?, "thumbnailUpdatedAt" = null
       where "id" = ? and "userId" = ?`,
    )
    .bind(sanitizeHtml(content.html), content.css, Date.now(), id, userId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function renameDocument(
  db: D1Database,
  id: string,
  userId: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `update "document" set "name" = ?, "updatedAt" = ? where "id" = ? and "userId" = ?`,
    )
    .bind(normalizeName(name), Date.now(), id, userId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function deleteDocument(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare(`delete from "document" where "id" = ? and "userId" = ?`)
    .bind(id, userId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Record that a thumbnail has been captured.
 *
 * Kept separate from `updateDocument` because thumbnail capture happens after
 * the save has already been acknowledged: a failed or rate-limited capture
 * must never turn a successful save into a failure.
 */
export async function markThumbnail(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `update "document" set "thumbnailUpdatedAt" = ? where "id" = ? and "userId" = ?`,
    )
    .bind(Date.now(), id, userId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

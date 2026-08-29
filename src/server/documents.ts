import { sanitizeCss, sanitizeHtml } from "../sanitize.ts";

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
  /** Bumped on every content write, so one save can be told from another. */
  revision: number;
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
  // Control and format characters go first. They are not cosmetic: a name is
  // shown on its card and inside the delete confirmation, and U+202E
  // (right-to-left override) makes a name render as something other than what
  // it is — the classic filename-spoofing trick, here aimed at a destructive
  // action. Zero-width characters give a name that looks blank but is not,
  // which is also why this runs before the empty check.
  const stripped = name.replace(/[\p{Cc}\p{Cf}]/gu, "");
  const collapsed = stripped.replace(/\s+/gu, " ").trim();
  if (!collapsed) return DEFAULT_NAME;
  // Truncate by code point, so a name ending in an emoji cannot be cut through
  // the middle of a surrogate pair and stored as broken text.
  return [...collapsed].slice(0, MAX_NAME_LENGTH).join("");
}

export async function createDocument(
  db: D1Database,
  userId: string,
  input: NewDocument,
): Promise<{ id: string; revision: number }> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `insert into "document"
         ("id","userId","name","html","css","thumbnailUpdatedAt","createdAt","updatedAt","revision")
       values (?, ?, ?, ?, ?, null, ?, ?, 1)`,
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

  // The caller needs the revision so a later thumbnail capture can prove the
  // content it rendered is still the content stored here.
  return { id, revision: 1 };
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
): Promise<{ revision: number } | null> {
  const result = await db
    .prepare(
      // The thumbnail is cleared because it depicts content that no longer
      // exists. A card showing a stale preview is worse than one showing none.
      `update "document"
         set "html" = ?, "css" = ?, "updatedAt" = ?, "revision" = "revision" + 1,
             "thumbnailUpdatedAt" = null
       where "id" = ? and "userId" = ?
       returning "revision"`,
    )
    .bind(sanitizeHtml(content.html), sanitizeCss(content.css), Date.now(), id, userId)
    .first<{ revision: number }>();

  return result ?? null;
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
 * Record that a thumbnail has been captured, if it still depicts the document.
 *
 * Kept separate from `updateDocument` because capture happens after the save
 * has been acknowledged: a failed or rate-limited capture must never turn a
 * successful save into a failure.
 *
 * Conditional on `revision` because captures race. Two quick saves start two
 * captures, and they can finish in either order — without this check the slower
 * one marks its now-superseded image as current, leaving the card showing
 * content that no longer exists until some later save happens to succeed. A
 * capture that loses the race simply marks nothing, and the card falls back to
 * "no preview", which is the honest answer.
 *
 * Keyed on the revision counter rather than `updatedAt`: Date.now() has
 * millisecond resolution, and two saves in the same millisecond would compare
 * equal, which is exactly the case this guards.
 */
export async function markThumbnail(
  db: D1Database,
  id: string,
  userId: string,
  contentRevision: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `update "document" set "thumbnailUpdatedAt" = ?
       where "id" = ? and "userId" = ? and "revision" = ?`,
    )
    .bind(Date.now(), id, userId, contentRevision)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

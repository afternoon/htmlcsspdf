import { normalizeName } from "./documentName.ts";
import { MAX_CONTENT_BYTES } from "./documentsApi.ts";

/**
 * What a dropped file means, and what it turns into.
 *
 * Plain module: no framework imports and no DOM beyond the small slice of
 * `File` it reads, so the rules can be tested exhaustively without rendering
 * anything or synthesising a drag.
 *
 * Both pages drop into the same rules. The editor replaces the pane a file
 * belongs to; the document list creates a document from the same result.
 */

/** Which editor pane a file belongs in. */
export type ContentKind = "html" | "css";

/**
 * The part of `File` this module uses.
 *
 * Structural rather than `File` itself so tests can pass literals: jsdom's
 * `File` has no working `text()`, and the rules under test are about names,
 * types and counts rather than about blobs.
 */
export interface DroppedFile {
  name: string;
  type: string;
  size: number;
  text(): Promise<string>;
}

/** A file that has been recognised, paired with the pane it fills. */
export interface ClassifiedFile {
  kind: ContentKind;
  file: DroppedFile;
}

/** Content taken from a drop; a pane is absent when no file supplied it. */
export interface DroppedContent {
  html?: string;
  css?: string;
  /** A document name derived from the file the content came from. */
  name: string;
}

export type DropPlan =
  | { ok: true; files: ClassifiedFile[] }
  | { ok: false; error: string };

export type DropResult =
  | { ok: true; content: DroppedContent }
  | { ok: false; error: string };

/** One file per pane, and there are two panes. */
export const MAX_DROPPED_FILES = 2;

/**
 * Types we accept, keyed by the MIME type the browser reports.
 *
 * XHTML is included because the file picker and some desktop environments
 * label a `.xhtml` file that way, and it is still markup for the HTML pane.
 */
const KIND_BY_MIME: Record<string, ContentKind> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/css": "css",
};

const KIND_BY_EXTENSION: Record<string, ContentKind> = {
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
};

/**
 * What pane a file fills, or null if we do not recognise it.
 *
 * The MIME type decides. The extension is consulted only when the browser
 * reports no type at all, which happens for files dragged from places the
 * platform has no mapping for — a recognised type that is not HTML or CSS is
 * a rejection, not an invitation to guess from the name.
 */
export function kindOf(file: DroppedFile): ContentKind | null {
  // Types may carry parameters, e.g. `text/html;charset=utf-8`.
  const mime = file.type.split(";")[0].trim().toLowerCase();
  if (mime) return KIND_BY_MIME[mime] ?? null;

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXTENSION[extension] ?? null;
}

const KIND_LABEL: Record<ContentKind, string> = { html: "HTML", css: "CSS" };

/**
 * Decide what a set of dropped files should do, without reading any of them.
 *
 * Every rejection names the file at fault where there is one: "that is not an
 * HTML or CSS file" is far less use than saying which of the two you dropped
 * was the problem.
 */
export function planDrop(files: readonly DroppedFile[]): DropPlan {
  if (files.length === 0) return { ok: false, error: "Drop an HTML or a CSS file." };

  if (files.length > MAX_DROPPED_FILES) {
    return {
      ok: false,
      error: `Drop at most ${MAX_DROPPED_FILES} files — one HTML and one CSS.`,
    };
  }

  const classified: ClassifiedFile[] = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      return { ok: false, error: `“${file.name}” is not an HTML or a CSS file.` };
    }

    if (file.size > MAX_CONTENT_BYTES) {
      return {
        ok: false,
        error: `“${file.name}” is too large — keep files under 2 MB.`,
      };
    }

    if (classified.some((other) => other.kind === kind)) {
      return {
        ok: false,
        error: `Drop one HTML file and one CSS file, not two ${KIND_LABEL[kind]} files.`,
      };
    }

    classified.push({ kind, file });
  }

  return { ok: true, files: classified };
}

/**
 * The document name a drop suggests.
 *
 * The HTML file wins when there is one, since it is the document proper and
 * the stylesheet is usually named after the site rather than the page. The
 * extension is dropped and the result run through the same normalisation a
 * typed name gets, so a dropped file cannot store a name the rename field
 * would refuse.
 */
export function nameForDrop(files: readonly ClassifiedFile[]): string {
  const primary = files.find((entry) => entry.kind === "html") ?? files[0];
  const fileName = primary?.file.name ?? "";
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "");
  return normalizeName(withoutExtension);
}

/**
 * Read a drop into content, or explain why it cannot be used.
 *
 * Reading can fail after the plan succeeds — a file moved or unmounted between
 * the drag starting and the drop landing still gives a `File` whose bytes are
 * gone — so failures here are reported the same way as a bad file type rather
 * than thrown at the caller.
 */
export async function readDrop(files: readonly DroppedFile[]): Promise<DropResult> {
  const plan = planDrop(files);
  if (!plan.ok) return plan;

  const content: DroppedContent = { name: nameForDrop(plan.files) };
  for (const { kind, file } of plan.files) {
    try {
      content[kind] = await file.text();
    } catch {
      return { ok: false, error: `Could not read “${file.name}”.` };
    }
  }

  return { ok: true, content };
}

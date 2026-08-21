import { SAMPLE_CSS, SAMPLE_HTML } from "./sample.ts";

/**
 * Persistence for editor content and pane layout.
 *
 * Plain module: no framework imports, so it is testable without rendering and
 * survives a UI rewrite.
 */

const DOC_KEY = "htmlcsspdf.doc.v1";
const LAYOUT_KEY = "htmlcsspdf.layout.v1";

// Keys used before the project was renamed. Read once so an existing user
// keeps their document instead of finding the sample back in the editor.
const LEGACY_KEYS: Record<string, string> = {
  [DOC_KEY]: "pdfpen.doc.v1",
  [LAYOUT_KEY]: "pdfpen.layout.v1",
};

export interface Doc {
  html: string;
  css: string;
}

export interface Layout {
  /** Fraction of the width taken by the editor column. */
  editors: number;
  /** Fraction of the editor column's height taken by the HTML pane. */
  htmlRows: number;
}

/** Editors take half the width; within them HTML gets twice the height of CSS. */
export const DEFAULT_LAYOUT: Layout = { editors: 0.5, htmlRows: 2 / 3 };

/** Neither pane may be dragged shut. */
export const MIN_FRACTION = 0.15;
export const MAX_FRACTION = 0.85;

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LAYOUT.editors;
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, value));
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key) ?? readLegacy(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Unavailable, disabled, or corrupt — callers fall back to defaults.
    return null;
  }
}

/** Migrate a value stored under the pre-rename key, then retire that key. */
function readLegacy(key: string): string | null {
  const legacyKey = LEGACY_KEYS[key];
  if (!legacyKey) return null;
  const raw = localStorage.getItem(legacyKey);
  if (raw === null) return null;
  try {
    localStorage.setItem(key, raw);
    localStorage.removeItem(legacyKey);
  } catch {
    // Migration is best-effort; the value is still returned either way.
  }
  return raw;
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable; not worth interrupting the user.
  }
}

export function loadDoc(): Doc {
  const parsed = readJson(DOC_KEY) as Partial<Doc> | null;
  return {
    html: typeof parsed?.html === "string" ? parsed.html : SAMPLE_HTML,
    css: typeof parsed?.css === "string" ? parsed.css : SAMPLE_CSS,
  };
}

export function saveDoc(doc: Doc): void {
  writeJson(DOC_KEY, doc);
}

export function loadLayout(): Layout {
  const parsed = readJson(LAYOUT_KEY) as Partial<Layout> | null;
  return {
    editors:
      typeof parsed?.editors === "number"
        ? clampFraction(parsed.editors)
        : DEFAULT_LAYOUT.editors,
    htmlRows:
      typeof parsed?.htmlRows === "number"
        ? clampFraction(parsed.htmlRows)
        : DEFAULT_LAYOUT.htmlRows,
  };
}

export function saveLayout(layout: Layout): void {
  writeJson(LAYOUT_KEY, layout);
}

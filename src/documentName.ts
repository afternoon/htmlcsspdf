/**
 * Document naming rules, shared by the editor and the server.
 *
 * Plain module with no framework or binding imports, so the same rules apply
 * wherever a name is accepted — the client cannot show one result while the
 * server stores another.
 */

/** Longest accepted document name. */
export const MAX_NAME_LENGTH = 200;

/** What a document is called before anyone names it. */
export const DEFAULT_DOCUMENT_NAME = "Untitled";

/**
 * Normalise a user-supplied name.
 *
 * Beyond collapsing whitespace, this strips control and format characters.
 * Those are not cosmetic: a name is shown on the card and inside the delete
 * confirmation, so U+202E (right-to-left override) lets a name render
 * differently from what it is — the classic filename-spoofing trick, here
 * pointed at a destructive action. Zero-width characters give a name that
 * looks blank but is not, which is also why this runs before the empty check.
 *
 * Truncation is by code point rather than UTF-16 unit, so a name ending in an
 * emoji cannot be cut through the middle of a surrogate pair and stored as
 * broken text.
 */
export function normalizeName(name: string): string {
  const stripped = name.replace(/[\p{Cc}\p{Cf}]/gu, "");
  const collapsed = stripped.replace(/\s+/gu, " ").trim();
  if (!collapsed) return DEFAULT_DOCUMENT_NAME;
  return [...collapsed].slice(0, MAX_NAME_LENGTH).join("");
}

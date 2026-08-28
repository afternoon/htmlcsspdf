import { z } from "zod";
import type { Doc } from "./storage.ts";

/**
 * The unsaved draft: editor content that is not yet a document.
 *
 * It exists for two moments. A refresh mid-edit should not lose work, and
 * signing in unloads the page entirely — Google navigates away and back — so
 * anything held only in React state is gone by the time the user returns.
 *
 * A draft is not a document. It has no name, no id, and no owner; it becomes a
 * document the first time it is saved, at which point it is cleared.
 */

const DRAFT_KEY = "htmlcsspdf.draft.v1";
const PENDING_SAVE_KEY = "htmlcsspdf.pendingSave.v1";

/** Storage is untrusted: a user can edit it, and old versions may linger. */
const DraftSchema = z.object({
  html: z.string(),
  css: z.string(),
});

export function saveDraft(doc: Doc): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch {
    // Storage full, disabled, or unavailable. Losing the draft is bad, but
    // interrupting the user mid-edit to say so is worse.
  }
}

export function loadDraft(): Doc | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing useful to do; the draft is overwritten on the next save anyway.
  }
}

/**
 * Remember that the user pressed Save before being sent to sign in, so the
 * name dialog can open by itself when they come back.
 */
export function markPendingSave(): void {
  try {
    localStorage.setItem(PENDING_SAVE_KEY, "1");
  } catch {
    // Without this the user simply presses Save again.
  }
}

/**
 * Whether a save was pending, clearing the flag as it reads.
 *
 * Read-once on purpose: leaving it set would reopen the name dialog on every
 * later visit, long after the save it referred to.
 */
export function takePendingSave(): boolean {
  try {
    const pending = localStorage.getItem(PENDING_SAVE_KEY) === "1";
    localStorage.removeItem(PENDING_SAVE_KEY);
    return pending;
  } catch {
    return false;
  }
}

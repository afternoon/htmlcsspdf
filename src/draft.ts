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
 * How long a pending save stays meaningful.
 *
 * Long enough to sign in — including creating a Google account or picking
 * between several — and short enough that an abandoned attempt does not
 * resurface. Without a bound the flag survives indefinitely: abandon a sign-in
 * once, and the next visit days later opens a naming dialog nobody asked for.
 */
const PENDING_SAVE_TTL_MS = 10 * 60 * 1000;

/**
 * Remember that the user pressed Save before being sent to sign in, so the
 * name dialog can open by itself when they come back.
 */
export function markPendingSave(): void {
  try {
    localStorage.setItem(PENDING_SAVE_KEY, String(Date.now()));
  } catch {
    // Without this the user simply presses Save again.
  }
}

/**
 * Whether a save was pending recently, clearing the flag as it reads.
 *
 * Read-once *and* time-bounded: reading once stops it reopening the dialog on
 * every later visit, and the expiry stops a sign-in the user walked away from
 * acting on a visit that has nothing to do with it.
 */
export function takePendingSave(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(PENDING_SAVE_KEY);
    localStorage.removeItem(PENDING_SAVE_KEY);
    if (raw === null) return false;

    const markedAt = Number(raw);
    if (!Number.isFinite(markedAt)) return false;
    // Bounded at both ends: a timestamp in the future — from a skewed clock or
    // a hand-edited value, which this module already assumes is possible —
    // would otherwise never expire.
    const age = now - markedAt;
    return age >= 0 && age < PENDING_SAVE_TTL_MS;
  } catch {
    return false;
  }
}

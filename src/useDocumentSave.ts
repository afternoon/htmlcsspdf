import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./authClient.ts";
import { DEFAULT_DOCUMENT_NAME } from "./documentName.ts";
import * as api from "./documentsApi.ts";
import { clearDraft, markPendingSave, takePendingSave } from "./draft.ts";
import type { Doc } from "./storage.ts";

/**
 * Saving a document from the editor.
 *
 * Holds the interaction, which is more than "POST the content": pressing Save
 * while signed out has to survive a full page unload, because Google takes the
 * browser away and brings it back. The draft is already in localStorage; this
 * remembers that Save was what the user was doing, so returning finishes it.
 *
 * A new document is created as "Untitled" and named afterwards, in the header.
 * Save stores the work rather than putting a form in front of it.
 *
 * Once a document exists it saves itself. Pressing Save is then a way to store
 * the work *now*, not the only way it is ever stored — a document that has a
 * name and a home should not be able to lose an afternoon's editing because
 * nobody pressed a button. Work with neither is still explicit: a draft has no
 * owner to save it for, so `/` keeps behaving exactly as it did.
 */

/** How long the editor must be quiet before an existing document is written. */
const AUTO_SAVE_DEBOUNCE_MS = 1500;

/**
 * How long it must then stay quiet before the preview image is refreshed.
 *
 * An order of magnitude slower than the save itself, and deliberately so.
 * Writing content is a database row; rendering the card's preview is a browser
 * session against a shared, quota-bound service that the PDF output depends on
 * too. Content is worth saving on every pause — the picture of it is worth
 * rendering once the editing has actually stopped.
 */
const PREVIEW_DEBOUNCE_MS = 15_000;

export type SaveState = "idle" | "saving" | "saved" | "error";

interface UseDocumentSave {
  /** Set when editing a document that already exists. */
  documentId: string | null;
  signInOpen: boolean;
  /** True after signing in, when a save the user began should now complete. */
  resumePending: boolean;
  /** The document's name, editable in the header once it exists. */
  name: string | null;
  renaming: boolean;
  rename: (name: string) => void;
  /** What to report for the content currently in the editor. */
  state: SaveState;
  error: string | null;
  requestSave: () => void;
  closeSignIn: () => void;
}

export function useDocumentSave(
  html: string,
  css: string,
  initialDocumentId: string | null = null,
  initialName: string | null = null,
): UseDocumentSave {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [signInOpen, setSignInOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [renaming, setRenaming] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // What was last written, so "Saved" can be checked against the editor rather
  // than latched. Without this the button read "Saved" forever — including
  // over a hundred lines of new, unsaved work.
  //
  // An existing document starts out already saved: the editor opens on exactly
  // what the loader read from the database, and treating that as unwritten
  // would have auto-save write every document back the moment it was opened.
  const [savedContent, setSavedContent] = useState<Doc | null>(
    initialDocumentId ? { html, css } : null,
  );
  // A quiet write leaves the stored preview cleared, so one is owed.
  const [previewPending, setPreviewPending] = useState(false);

  /**
   * Whether the editor holds exactly what was last written.
   *
   * Compared by content rather than tracked with a dirty flag: an edit that
   * happens to restore the saved text really is saved, and undo makes that
   * ordinary rather than exotic. It is also what decides whether auto-save has
   * anything to do, which a flag would get wrong in the same way.
   */
  const isSaved = savedContent?.html === html && savedContent?.css === css;

  /** What the button reports for the content on screen. */
  const state: SaveState = status === "saved" && !isSaved ? "idle" : status;

  /**
   * Resume a save the user started before being sent to sign in.
   *
   * Deferred until there is a session, rather than read during the first
   * render: the flag only means "finish the save", and finishing it requires
   * knowing sign-in actually succeeded.
   *
   * Latching on `!isPending` alone was not enough. better-auth commonly
   * reports "settled, no user" before the cookie-backed refetch lands, so the
   * guard would consume the one-shot flag on that inconclusive read and never
   * run again when the user actually arrived — the dialog simply never opened
   * after signing in, which is the whole feature. Waiting for a session means
   * a genuinely signed-out user leaves the flag alone, and its expiry retires
   * it instead.
   */
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || isPending || !session) return;
    resumed.current = true;

    // Only a document that does not exist yet has a save left to finish. The
    // content is not held here — it lives in the editor, which supplies it.
    if (takePendingSave() && !initialDocumentId) setResumePending(true);
  }, [isPending, session, initialDocumentId]);

  /**
   * Whether there is someone to save for.
   *
   * A boolean rather than the session object: better-auth hands back a fresh
   * one on each render, and an effect keyed on that identity would restart its
   * debounce every render instead of every edit.
   */
  const signedIn = !isPending && Boolean(session);

  /** True while a write is in flight, so two never overlap. */
  const writing = useRef(false);

  /**
   * Write the content to a document that already exists.
   *
   * Memoised by hand, against the house rule of leaving that to the React
   * Compiler: the effects below key their debounce on this identity, and a
   * fresh function per render would restart the timer instead of the edit
   * doing it. The compiler cannot be relied on for that here — it declines
   * whole functions it cannot reason about, and correctness would silently
   * follow whether it did.
   */
  const write = useCallback(
    async (id: string, doc: Doc, { capturePreview = true } = {}) => {
      writing.current = true;
      setStatus("saving");
      setError(null);
      try {
        await api.saveDocument(id, doc.html, doc.css, { capturePreview });
        setSavedContent(doc);
        setStatus("saved");
        // Every content write clears the stored preview, so a quiet one leaves
        // the card without an image until it is asked for separately.
        setPreviewPending(!capturePreview);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not save.");
      }
      // Reached on both paths — the catch above swallows the failure — so the
      // flag clears without a `finally`, which the React Compiler cannot
      // compile.
      writing.current = false;
    },
    [],
  );

  /**
   * Save an existing document once the typing pauses.
   *
   * Only for a document that exists and belongs to someone: a draft has no id
   * to write to, and a signed-out user has nowhere to write it.
   *
   * A write in flight is not queued behind a second timer. `savedContent`
   * changes when it lands, which re-runs this — and it re-runs against the
   * content as it is *then*, so anything typed during the request is picked up
   * by the next pass instead of being written from a stale closure. A failed
   * write leaves that unchanged, so it retries on the next edit rather than
   * immediately: the button says "Retry save" in the meantime, and hammering a
   * server that just refused is not a fix.
   */
  useEffect(() => {
    if (!documentId || !signedIn) return;
    // Compared against `savedContent` itself rather than the derived flag: a
    // write that lands while the user keeps typing leaves the flag false
    // throughout, so an effect keyed on it would never re-run and the newer
    // text would sit unsaved until the next keystroke.
    if (savedContent?.html === html && savedContent?.css === css) return;
    if (writing.current) return;

    const timer = setTimeout(
      () => void write(documentId, { html, css }, { capturePreview: false }),
      AUTO_SAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [html, css, documentId, signedIn, savedContent, write]);

  /**
   * Refresh the card's preview once the editing has stopped.
   *
   * Held back until the editor matches what is stored: rendering a preview of
   * content that is about to be overwritten spends a browser session on an
   * image that is already wrong. Best-effort throughout — a document with no
   * preview shows a placeholder, which is a normal state and never an error
   * worth putting in front of someone who is editing.
   */
  useEffect(() => {
    if (!documentId || !previewPending) return;
    if (savedContent?.html !== html || savedContent?.css !== css) return;

    const timer = setTimeout(() => {
      setPreviewPending(false);
      void api.capturePreview(documentId).catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html, css, documentId, previewPending, savedContent]);

  function requestSave() {
    // The session is still resolving; a click now would misread it as signed
    // out and bounce the user to Google unnecessarily.
    if (isPending) return;

    if (!session) {
      // Remembered across the redirect, so returning finishes the save.
      markPendingSave();
      setSignInOpen(true);
      return;
    }

    // Asked for explicitly, so this one refreshes the preview: the user has
    // stopped to press a button, which is as settled as the editing gets.
    if (documentId) {
      void write(documentId, { html, css });
      return;
    }

    setResumePending(false);
    void create({ html, css });
  }

  /**
   * Create the document, naming it later.
   *
   * Saving no longer asks for a name first: the document is created as
   * "Untitled" and renamed in place from the header. Pressing Save should
   * store the work, not open a form between the user and their own document.
   */
  async function create(doc: Doc) {
    setStatus("saving");
    setError(null);
    try {
      const id = await api.createDocument({
        name: DEFAULT_DOCUMENT_NAME,
        html: doc.html,
        css: doc.css,
      });
      setDocumentId(id);
      setName(DEFAULT_DOCUMENT_NAME);
      setSavedContent(doc);
      setStatus("saved");
      // The draft has become a document, so it is no longer a draft — and from
      // here on it saves itself.
      clearDraft();
      await navigate({ to: "/d/$id", params: { id } });
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  /**
   * Rename in place, optimistically.
   *
   * The header shows the new name immediately and reverts if the request
   * fails: a rename is small, reversible, and the user is looking straight at
   * the field they just edited.
   */
  function rename(next: string) {
    if (!documentId || next === name) return;

    const previous = name;
    setName(next);
    setRenaming(true);

    void api
      .renameDocument(documentId, next)
      .catch((e) => {
        setName(previous);
        setError(e instanceof Error ? e.message : "Could not rename.");
      })
      .finally(() => setRenaming(false));
  }

  return {
    documentId,
    signInOpen,
    resumePending,
    name,
    renaming,
    rename,
    state,
    error,
    requestSave,
    closeSignIn: () => setSignInOpen(false),
  };
}

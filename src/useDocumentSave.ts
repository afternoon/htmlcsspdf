import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
 */

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
  state: SaveState;
  error: string | null;
  /** The state to show for `doc`, which reverts to idle once it is edited. */
  stateFor: (doc: Doc) => SaveState;
  requestSave: (doc: Doc) => void;
  closeSignIn: () => void;
}

export function useDocumentSave(
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
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // What was last written, so "Saved" can be checked against the editor rather
  // than latched. Without this the button read "Saved" forever — including
  // over a hundred lines of new, unsaved work.
  const [savedContent, setSavedContent] = useState<Doc | null>(null);

  /**
   * Whether `doc` is what we last saved.
   *
   * Compared by content rather than tracked with a dirty flag: an edit that
   * happens to restore the saved text really is saved, and undo makes that
   * ordinary rather than exotic.
   */
  function stateFor(doc: Doc): SaveState {
    if (state !== "saved") return state;
    if (!savedContent) return "idle";
    const unchanged = savedContent.html === doc.html && savedContent.css === doc.css;
    return unchanged ? "saved" : "idle";
  }

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

  function requestSave(doc: Doc) {
    // The session is still resolving; a click now would misread it as signed
    // out and bounce the user to Google unnecessarily.
    if (isPending) return;

    if (!session) {
      // Remembered across the redirect, so returning finishes the save.
      markPendingSave();
      setSignInOpen(true);
      return;
    }

    if (documentId) {
      void save(documentId, doc);
      return;
    }

    setResumePending(false);
    void create(doc);
  }

  async function save(id: string, doc: Doc) {
    setState("saving");
    setError(null);
    try {
      await api.saveDocument(id, doc.html, doc.css);
      setSavedContent(doc);
      setState("saved");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  /**
   * Create the document, naming it later.
   *
   * Saving no longer asks for a name first: the document is created as
   * "Untitled" and renamed in place from the header. Pressing Save should
   * store the work, not open a form between the user and their own document.
   */
  async function create(doc: Doc) {
    setState("saving");
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
      setState("saved");
      // The draft has become a document, so it is no longer a draft.
      clearDraft();
      await navigate({ to: "/d/$id", params: { id } });
    } catch (e) {
      setState("error");
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
    stateFor,
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

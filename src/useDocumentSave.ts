import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSession } from "./authClient.ts";
import * as api from "./documentsApi.ts";
import { clearDraft, markPendingSave, takePendingSave } from "./draft.ts";
import type { Doc } from "./storage.ts";

/**
 * Saving a document from the editor.
 *
 * Holds the interaction, which is more than "POST the content": pressing Save
 * while signed out has to survive a full page unload, because Google takes the
 * browser away and brings it back. The draft is already in localStorage; this
 * remembers that Save was what the user was doing, so the name dialog can
 * reopen by itself on return.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

interface UseDocumentSave {
  /** Set when editing a document that already exists. */
  documentId: string | null;
  signInOpen: boolean;
  nameOpen: boolean;
  state: SaveState;
  error: string | null;
  requestSave: (doc: Doc) => void;
  confirmName: (name: string, doc: Doc) => Promise<void>;
  closeSignIn: () => void;
  closeName: () => void;
}

export function useDocumentSave(
  initialDocumentId: string | null = null,
): UseDocumentSave {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [signInOpen, setSignInOpen] = useState(false);
  // Opens by itself if the user pressed Save before being sent to sign in.
  //
  // Only for a document that has no name yet: the flag is read once, but a
  // stale one — from a sign-in abandoned earlier — must not pop a naming
  // dialog over a stored document that is already named. Clear it either way,
  // so it cannot fire later against some unrelated page.
  const [nameOpen, setNameOpen] = useState(() => {
    const pending = takePendingSave();
    return pending && !initialDocumentId;
  });
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  function requestSave(doc: Doc) {
    // The session is still resolving; a click now would misread it as signed
    // out and bounce the user to Google unnecessarily.
    if (isPending) return;

    if (!session) {
      // Remembered across the redirect, so returning reopens the name dialog.
      markPendingSave();
      setSignInOpen(true);
      return;
    }

    if (documentId) {
      void save(documentId, doc);
      return;
    }

    setNameOpen(true);
  }

  async function save(id: string, doc: Doc) {
    setState("saving");
    setError(null);
    try {
      await api.saveDocument(id, doc.html, doc.css);
      setState("saved");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function confirmName(name: string, doc: Doc) {
    setState("saving");
    setError(null);
    try {
      const id = await api.createDocument({ name, html: doc.html, css: doc.css });
      setDocumentId(id);
      setNameOpen(false);
      setState("saved");
      // The draft has become a document, so it is no longer a draft.
      clearDraft();
      await navigate({ to: "/d/$id", params: { id } });
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return {
    documentId,
    signInOpen,
    nameOpen,
    state,
    error,
    requestSave,
    confirmName,
    closeSignIn: () => setSignInOpen(false),
    closeName: () => setNameOpen(false),
  };
}

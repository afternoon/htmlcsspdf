import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  const [nameOpen, setNameOpen] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  /**
   * Resume a save the user started before being sent to sign in.
   *
   * Deferred until the session resolves, rather than read during the first
   * render: the flag only means "finish the save", and finishing it requires
   * knowing sign-in actually succeeded. Reading it too early opened the naming
   * dialog for people who were still signed out — and, before the flag gained
   * an expiry, for people who had abandoned a sign-in days earlier.
   *
   * Runs once either way, since `takePendingSave` clears as it reads.
   */
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || isPending) return;
    resumed.current = true;

    // A document that already has a name needs no naming dialog.
    if (takePendingSave() && session && !initialDocumentId) setNameOpen(true);
  }, [isPending, session, initialDocumentId]);

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

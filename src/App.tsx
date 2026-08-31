import { css as cssLang } from "@codemirror/lang-css";
import { html as htmlLang } from "@codemirror/lang-html";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./AppShell.tsx";
import { Divider } from "./Divider.tsx";
import { DropZone } from "./DropZone.tsx";
import { loadDraft, saveDraft } from "./draft.ts";
import { readDrop } from "./dropFiles.ts";
import { EditableName } from "./EditableName.tsx";
import { Editor } from "./Editor.tsx";
import { EditorActions } from "./EditorActions.tsx";
import { PreviewPane } from "./PreviewPane.tsx";
import { SignInDialog } from "./SignInDialog.tsx";
import { SAMPLE_CSS, SAMPLE_HTML } from "./sample.ts";
import type { Doc } from "./storage.ts";
import { Toast } from "./Toast.tsx";
import { useAutoFormat } from "./useAutoFormat.ts";
import { useDocumentSave } from "./useDocumentSave.ts";
import { useFileDrop } from "./useFileDrop.ts";
import { useLayout } from "./useLayout.ts";
import { useRenderer } from "./useRenderer.ts";
import { useToast } from "./useToast.ts";

const SAVE_DEBOUNCE_MS = 300;
const AUTO_PREVIEW_DEBOUNCE_MS = 1000;

interface AppProps {
  /** Set when editing a stored document; absent for a new one. */
  documentId?: string;
  documentName?: string;
  initialContent?: Doc;
}

export function App({ documentId, documentName, initialContent }: AppProps = {}) {
  // Read on first render, not at module scope: module-level state is shared
  // across mounts and captured before any test can seed storage.
  //
  // A stored document wins outright. Otherwise a fresh visit starts from the
  // sample, and a draft is restored only if one survives — from a refresh
  // mid-edit, or from the sign-in round trip.
  const [initial] = useState(
    () => initialContent ?? loadDraft() ?? { html: SAMPLE_HTML, css: SAMPLE_CSS },
  );
  const [html, setHtml] = useState(initial.html);
  const [css, setCss] = useState(initial.css);
  // Opt-in: every render costs browser time against a daily quota, so the
  // default is to render only when asked.
  const [autoPreview, setAutoPreview] = useState(false);

  const layout = useLayout();
  const { pdfUrl, error, rendering, render, clearError, isStale } = useRenderer();
  const save = useDocumentSave(documentId ?? null, documentName ?? null);
  const toast = useToast();

  const applyFormatted = useCallback((next: Doc) => {
    setHtml(next.html);
    setCss(next.css);
  }, []);
  const autoFormat = useAutoFormat(html, css, applyFormatted);

  // Re-render on a pause, but only while the toggle is on.
  useEffect(() => {
    if (!autoPreview) return;
    const timer = setTimeout(() => void render(html, css), AUTO_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html, css, render, autoPreview]);

  // Render once on load so the pane isn't empty.
  const didInitialRender = useRef(false);
  useEffect(() => {
    if (didInitialRender.current) return;
    didInitialRender.current = true;
    void render(initial.html, initial.css);
  }, [render, initial]);

  // Only unsaved work is drafted. A stored document already has a home, and
  // drafting it would resurrect it over the next new document.
  useEffect(() => {
    if (documentId) return;
    const timer = setTimeout(() => saveDraft({ html, css }), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html, css, documentId]);

  const renderNow = useCallback(() => {
    void render(html, css);
  }, [render, html, css]);

  // Cmd/Ctrl+Enter re-renders. The only way to render besides the button on
  // the stale overlay, now that the Preview button is gone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        renderNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renderNow]);

  function handleSave() {
    save.requestSave({ html, css });
  }

  /**
   * Replace a pane from a dropped file.
   *
   * Each file overwrites the pane it belongs to and leaves the other alone, so
   * dropping a stylesheet onto a document you are working on swaps the CSS
   * without touching the markup. There is no confirmation: the editor keeps
   * its own undo history, and the save is still the user's to make.
   */
  async function handleDrop(files: File[]) {
    const result = await readDrop(files);
    if (!result.ok) {
      toast.show(result.error);
      return;
    }

    if (result.content.html !== undefined) setHtml(result.content.html);
    if (result.content.css !== undefined) setCss(result.content.css);
  }

  // Declared after `handleDrop` rather than beside the other hooks: reading a
  // function declaration before its statement runs is a use-before-init the
  // React Compiler refuses to reason about, and it responds by skipping this
  // component entirely rather than by failing.
  const drop = useFileDrop((files) => void handleDrop(files));

  function handleDownload() {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `${save.name ?? "document"}.pdf`;
    a.click();
  }

  const title =
    save.name === null ? (
      <span className="status" data-busy={rendering || undefined}>
        {rendering ? "rendering…" : "idle"}
      </span>
    ) : (
      <EditableName name={save.name} onRename={save.rename} saving={save.renaming} />
    );

  return (
    <DropZone drop={drop} hint="Drop HTML or CSS to replace the matching pane">
      <SignInDialog open={save.signInOpen} onClose={save.closeSignIn} />
      <Toast toast={toast.toast} onDismiss={toast.dismiss} />

      <AppShell
        title={title}
        currentDocumentId={save.documentId ?? undefined}
        onSignIn={handleSave}
        actions={
          <EditorActions
            autoFormat={autoFormat.enabled}
            onAutoFormatChange={autoFormat.setEnabled}
            formatting={autoFormat.formatting}
            onSave={handleSave}
            saveState={save.stateFor({ html, css })}
          />
        }
      >
        <main
          className="panes"
          style={{
            gridTemplateColumns: `${layout.editors}fr 6px ${1 - layout.editors}fr`,
          }}
        >
          <div
            className="editor-column"
            style={{
              gridTemplateRows: `${layout.htmlRows}fr 6px ${1 - layout.htmlRows}fr`,
            }}
          >
            <section className="pane" aria-label="HTML">
              <div className="pane-label">HTML</div>
              <Editor
                value={html}
                language={htmlLang()}
                onChange={setHtml}
                label="HTML"
              />
            </section>

            <Divider
              orientation="horizontal"
              label="Resize HTML and CSS panes"
              fraction={layout.htmlRows}
              onChange={layout.setHtmlRows}
            />

            <section className="pane" aria-label="CSS">
              <div className="pane-label">CSS</div>
              <Editor value={css} language={cssLang()} onChange={setCss} label="CSS" />
            </section>
          </div>

          <Divider
            orientation="vertical"
            label="Resize editors and preview"
            fraction={layout.editors}
            onChange={layout.setEditors}
          />

          <PreviewPane
            pdfUrl={pdfUrl}
            error={error}
            rendering={rendering}
            stale={isStale(html, css)}
            autoPreview={autoPreview}
            onAutoPreviewChange={setAutoPreview}
            onUpdate={renderNow}
            onDismissError={clearError}
            onDownload={handleDownload}
          />
        </main>
      </AppShell>
    </DropZone>
  );
}

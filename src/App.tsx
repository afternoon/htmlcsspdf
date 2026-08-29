import { css as cssLang } from "@codemirror/lang-css";
import { html as htmlLang } from "@codemirror/lang-html";
import { useCallback, useEffect, useRef, useState } from "react";
import { Divider } from "./Divider.tsx";
import { describeIssue, formatCss, formatHtml } from "./document.ts";
import { loadDraft, saveDraft } from "./draft.ts";
import { Editor } from "./Editor.tsx";
import { SignInDialog } from "./SignInDialog.tsx";
import { SAMPLE_CSS, SAMPLE_HTML } from "./sample.ts";
import type { Doc } from "./storage.ts";
import { Toolbar } from "./Toolbar.tsx";
import { useDocumentSave } from "./useDocumentSave.ts";
import { useLayout } from "./useLayout.ts";
import { useRenderer } from "./useRenderer.ts";

const DEBOUNCE_MS = 1000;
const SAVE_DEBOUNCE_MS = 300;

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
  // Auto-preview is opt-in: renders cost browser time, so default to manual.
  const [autoPreview, setAutoPreview] = useState(false);
  const [formatting, setFormatting] = useState(false);

  const layout = useLayout();
  const { pdfUrl, error, rendering, render, clearError, setError } = useRenderer();
  const save = useDocumentSave(documentId ?? null, documentName ?? null);

  // Debounced auto-render on edit, only while the toggle is on.
  useEffect(() => {
    if (!autoPreview) return;
    const timer = setTimeout(() => void render(html, css), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html, css, render, autoPreview]);

  // Render once on load so the pane isn't empty, even with auto-preview off.
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

  // Cmd/Ctrl+Enter renders regardless of the toggle.
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

  const format = useCallback(async () => {
    setFormatting(true);
    try {
      const [formattedHtml, formattedCss] = await Promise.all([
        formatHtml(html),
        formatCss(css),
      ]);
      if (formattedHtml.changed) setHtml(formattedHtml.text);
      if (formattedCss.changed) setCss(formattedCss.text);
      const failed = formattedHtml.error ?? formattedCss.error;
      if (failed) {
        setError({
          message: describeIssue(failed),
          hint: "Could not format — fix the syntax error.",
        });
      }
    } finally {
      setFormatting(false);
    }
  }, [html, css, setError]);

  const download = useCallback(() => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = "document.pdf";
    a.click();
  }, [pdfUrl]);

  function handleSave() {
    save.requestSave({ html, css });
  }

  const reset = useCallback(() => {
    setHtml(SAMPLE_HTML);
    setCss(SAMPLE_CSS);
  }, []);

  return (
    <div className="app">
      <Toolbar
        autoPreview={autoPreview}
        onAutoPreviewChange={setAutoPreview}
        onReset={reset}
        onFormat={format}
        onPreview={renderNow}
        onDownload={download}
        onSave={handleSave}
        onSignIn={handleSave}
        formatting={formatting}
        rendering={rendering}
        canDownload={pdfUrl !== null}
        saveState={save.stateFor({ html, css })}
        documentName={save.name ?? undefined}
        onRename={save.rename}
        renaming={save.renaming}
      />

      <SignInDialog open={save.signInOpen} onClose={save.closeSignIn} />

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
            <Editor value={html} language={htmlLang()} onChange={setHtml} label="HTML" />
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

        <section className="pane preview" aria-label="Preview">
          <div className="pane-label">Preview</div>
          <div className="preview-body">
            {pdfUrl ? (
              // navpanes=0 hides the page-list sidebar; view=FitH scales the
              // page to the pane, which matters now that the split is
              // draggable. Note that toolbar=0 must NOT be added here: on a
              // blob: URL it makes Chrome's viewer lay out to nothing and the
              // page renders blank.
              <iframe src={`${pdfUrl}#navpanes=0&view=FitH`} title="PDF preview" />
            ) : (
              <div className="placeholder">
                {error ? "" : rendering ? "Rendering…" : "Press Preview to render."}
              </div>
            )}

            {/* The live region stays in the DOM so screen readers announce
                errors when they appear; a region inserted alongside its first
                message is often missed. */}
            <div className="error-overlay" role="alert" hidden={!error}>
              {error && (
                <div className="error-card">
                  <div className="error-text">
                    <strong>{error.message}</strong>
                    {error.hint && <p>{error.hint}</p>}
                  </div>
                  <button
                    type="button"
                    className="error-dismiss"
                    onClick={clearError}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

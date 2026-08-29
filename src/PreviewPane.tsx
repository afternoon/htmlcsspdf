import { Download } from "lucide-react";
import { StalePreviewOverlay } from "./StalePreviewOverlay.tsx";
import type { RenderError } from "./useRenderer.ts";

interface PreviewPaneProps {
  pdfUrl: string | null;
  error: RenderError | null;
  rendering: boolean;
  stale: boolean;
  autoPreview: boolean;
  onAutoPreviewChange: (enabled: boolean) => void;
  onUpdate: () => void;
  onDismissError: () => void;
  onDownload: () => void;
}

/** The rendered PDF, what is wrong with it, and what to do about it. */
export function PreviewPane({
  pdfUrl,
  error,
  rendering,
  stale,
  autoPreview,
  onAutoPreviewChange,
  onUpdate,
  onDismissError,
  onDownload,
}: PreviewPaneProps) {
  return (
    <section className="pane preview" aria-label="Preview">
      <div className="pane-label">Preview</div>
      <div className="preview-body">
        {pdfUrl ? (
          // navpanes=0 hides the page-list sidebar; view=FitH scales the page
          // to the pane, which matters now that the split is draggable. Note
          // that toolbar=0 must NOT be added here: on a blob: URL it makes
          // Chrome's viewer lay out to nothing and the page renders blank.
          <iframe
            src={`${pdfUrl}#navpanes=0&view=FitH`}
            title="PDF preview"
            data-stale={stale || undefined}
          />
        ) : (
          <div className="placeholder">
            {error ? "" : rendering ? "Rendering…" : "Nothing rendered yet."}
          </div>
        )}

        <StalePreviewOverlay
          stale={stale && pdfUrl !== null}
          rendering={rendering}
          onUpdate={onUpdate}
        />

        {/* The live region stays in the DOM so screen readers announce errors
            when they appear; a region inserted alongside its first message is
            often missed. */}
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
                onClick={onDismissError}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Both controls sit with the preview they act on rather than in the
          header, where they were competing with the primary action. */}
      <div className="preview-actions">
        <label className="toggle">
          <input
            type="checkbox"
            checked={autoPreview}
            onChange={(e) => onAutoPreviewChange(e.target.checked)}
          />
          <span>Auto preview</span>
        </label>
        <button
          type="button"
          data-variant="ghost"
          onClick={onDownload}
          disabled={!pdfUrl}
        >
          <Download size={16} aria-hidden="true" />
          Download PDF
        </button>
      </div>
    </section>
  );
}

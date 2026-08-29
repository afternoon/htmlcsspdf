import { RefreshCw } from "lucide-react";

/**
 * The modifier this platform uses, for the keyboard hint.
 *
 * Guarded for the server, where there is no navigator; Ctrl is the safer
 * default there, since the Mac reading would be wrong for most visitors.
 */
function shortcutModifier(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘" : "Ctrl";
}

interface StalePreviewOverlayProps {
  /** The editor has moved on from what the PDF below shows. */
  stale: boolean;
  rendering: boolean;
  onUpdate: () => void;
}

/**
 * Covers the preview once it no longer matches the editor.
 *
 * The stale PDF stays visible but blurred behind this, which says more than
 * hiding it would: the shape of the last render is still useful context, and
 * blurring it makes clear it is not to be read as current.
 *
 * Not a `<dialog>`, deliberately. This must not trap focus or block the
 * editor — the user's next action is usually to keep typing, and a modal that
 * demanded dismissal before every keystroke would be intolerable.
 */
export function StalePreviewOverlay({
  stale,
  rendering,
  onUpdate,
}: StalePreviewOverlayProps) {
  if (!stale) return null;

  return (
    <div className="preview-stale">
      <div className="preview-stale-card">
        <p className="preview-stale-text">
          {rendering ? "Updating the preview…" : "This preview is out of date."}
        </p>
        <button type="button" onClick={onUpdate} disabled={rendering}>
          <RefreshCw size={16} aria-hidden="true" />
          {rendering ? "Updating…" : "Update Preview"}
        </button>
        <p className="preview-stale-hint">
          <kbd>{shortcutModifier()}</kbd> + <kbd>Enter</kbd>
        </p>
      </div>
    </div>
  );
}

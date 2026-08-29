import { AccountMenu } from "./AccountMenu.tsx";
import { EditableName } from "./EditableName.tsx";
import type { SaveState } from "./useDocumentSave.ts";

interface ToolbarProps {
  autoPreview: boolean;
  onAutoPreviewChange: (enabled: boolean) => void;
  onReset: () => void;
  onFormat: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onSave: () => void;
  onSignIn: () => void;
  formatting: boolean;
  rendering: boolean;
  canDownload: boolean;
  saveState: SaveState;
  /** Present once the document exists; editable in place. */
  documentName?: string;
  onRename?: (name: string) => void;
  renaming?: boolean;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Save",
  saving: "Saving…",
  saved: "Saved",
  error: "Retry save",
};

/** The application header: status and the document actions. Renders only. */
export function Toolbar({
  autoPreview,
  onAutoPreviewChange,
  onReset,
  onFormat,
  onPreview,
  onDownload,
  onSave,
  onSignIn,
  formatting,
  rendering,
  canDownload,
  saveState,
  documentName,
  onRename,
  renaming,
}: ToolbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        htmlcsspdf
        {documentName !== undefined && onRename ? (
          <EditableName name={documentName} onRename={onRename} saving={renaming} />
        ) : (
          <span className="status" data-busy={rendering || undefined}>
            {rendering ? "rendering…" : "idle"}
          </span>
        )}
      </div>
      <div className="actions">
        <label className="toggle">
          <input
            type="checkbox"
            checked={autoPreview}
            onChange={(e) => onAutoPreviewChange(e.target.checked)}
          />
          <span>Auto preview</span>
        </label>
        <button type="button" onClick={onReset} data-variant="ghost">
          Reset
        </button>
        <button
          type="button"
          onClick={onFormat}
          disabled={formatting}
          data-variant="ghost"
        >
          {formatting ? "Formatting…" : "Format"}
        </button>
        <button type="button" onClick={onPreview} disabled={rendering}>
          Preview
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload}
          data-variant="ghost"
        >
          Download PDF
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saveState === "saving"}
          data-state={saveState}
        >
          {SAVE_LABEL[saveState]}
        </button>
        <AccountMenu onSignIn={onSignIn} />
      </div>
    </header>
  );
}

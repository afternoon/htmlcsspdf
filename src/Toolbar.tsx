import { Menu } from "lucide-react";
import { EditableName } from "./EditableName.tsx";
import type { SaveState } from "./useDocumentSave.ts";

interface ToolbarProps {
  menuOpen: boolean;
  onToggleMenu: () => void;
  autoFormat: boolean;
  onAutoFormatChange: (enabled: boolean) => void;
  formatting: boolean;
  rendering: boolean;
  onSave: () => void;
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

/**
 * The application header.
 *
 * One primary action — Save. Everything that used to sit beside it has moved
 * to where it belongs: navigation into the left panel, Download beneath the
 * PDF it produces, and re-rendering onto the preview it affects.
 */
export function Toolbar({
  menuOpen,
  onToggleMenu,
  autoFormat,
  onAutoFormatChange,
  formatting,
  rendering,
  onSave,
  saveState,
  documentName,
  onRename,
  renaming,
}: ToolbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <button
          type="button"
          className="menu-button"
          onClick={onToggleMenu}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          <Menu size={18} aria-hidden="true" />
        </button>
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
            checked={autoFormat}
            onChange={(e) => onAutoFormatChange(e.target.checked)}
          />
          <span>{formatting ? "Formatting…" : "Format HTML/CSS"}</span>
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={saveState === "saving"}
          data-state={saveState}
        >
          {SAVE_LABEL[saveState]}
        </button>
      </div>
    </header>
  );
}

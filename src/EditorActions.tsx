import { FilePlus2 } from "lucide-react";
import type { SaveState } from "./useDocumentSave.ts";

interface EditorActionsProps {
  autoFormat: boolean;
  onAutoFormatChange: (enabled: boolean) => void;
  formatting: boolean;
  onSave: () => void;
  saveState: SaveState;
  /** Opens the file picker — the keyboard path to what a drop does. */
  onOpenFiles: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Save",
  saving: "Saving…",
  saved: "Saved",
  error: "Retry save",
};

/**
 * The editor's header controls: one primary action, and the format toggle.
 *
 * Everything that used to sit beside Save has moved to where it belongs —
 * navigation into the left panel, Download and Auto preview beneath the PDF
 * they act on, and re-rendering onto the preview itself.
 */
export function EditorActions({
  autoFormat,
  onAutoFormatChange,
  formatting,
  onSave,
  saveState,
  onOpenFiles,
}: EditorActionsProps) {
  return (
    <>
      {/* Files can be dropped anywhere on the page, but a drag is a pointer
          gesture with no keyboard equivalent. This is that equivalent. */}
      <button type="button" data-variant="ghost" onClick={onOpenFiles}>
        <FilePlus2 size={14} aria-hidden="true" />
        Open files
      </button>

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
    </>
  );
}

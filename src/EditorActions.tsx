import type { SaveState } from "./useDocumentSave.ts";

interface EditorActionsProps {
  autoFormat: boolean;
  onAutoFormatChange: (enabled: boolean) => void;
  formatting: boolean;
  onSave: () => void;
  saveState: SaveState;
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
}: EditorActionsProps) {
  return (
    <>
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

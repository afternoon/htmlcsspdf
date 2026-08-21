interface ToolbarProps {
  autoPreview: boolean;
  onAutoPreviewChange: (enabled: boolean) => void;
  onReset: () => void;
  onFormat: () => void;
  onPreview: () => void;
  onDownload: () => void;
  formatting: boolean;
  rendering: boolean;
  canDownload: boolean;
}

/** The application header: status and the document actions. Renders only. */
export function Toolbar({
  autoPreview,
  onAutoPreviewChange,
  onReset,
  onFormat,
  onPreview,
  onDownload,
  formatting,
  rendering,
  canDownload,
}: ToolbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        htmlcsspdf
        <span className="status" data-busy={rendering || undefined}>
          {rendering ? "rendering…" : "idle"}
        </span>
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
      </div>
    </header>
  );
}

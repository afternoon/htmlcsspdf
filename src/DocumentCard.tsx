import { Link } from "@tanstack/react-router";
import { type DocumentSummary, thumbnailUrl } from "./documentsApi.ts";
import { formatRelativeTime } from "./formatRelativeTime.ts";

interface DocumentCardProps {
  document: DocumentSummary;
  onRename: (document: DocumentSummary) => void;
  onDelete: (document: DocumentSummary) => void;
}

/** One document in the list: preview, name, when it changed, and its actions. */
export function DocumentCard({ document, onRename, onDelete }: DocumentCardProps) {
  return (
    <li className="doc-card">
      <Link to="/d/$id" params={{ id: document.id }} className="doc-preview">
        {document.thumbnailUpdatedAt ? (
          <img
            src={thumbnailUrl(document.id, document.thumbnailUpdatedAt)}
            alt=""
            loading="lazy"
            width={794}
            height={1123}
          />
        ) : (
          // No thumbnail yet, or the capture failed — both are normal, and
          // neither is worth an error message on a card.
          <span className="doc-preview-empty">No preview</span>
        )}
      </Link>

      <div className="doc-meta">
        <Link to="/d/$id" params={{ id: document.id }} className="doc-title">
          {document.name}
        </Link>
        <time dateTime={new Date(document.updatedAt).toISOString()} className="doc-time">
          Edited {formatRelativeTime(document.updatedAt)}
        </time>
      </div>

      <div className="doc-actions">
        <button type="button" data-variant="ghost" onClick={() => onRename(document)}>
          Rename
        </button>
        <button type="button" data-variant="danger" onClick={() => onDelete(document)}>
          Delete
        </button>
      </div>
    </li>
  );
}

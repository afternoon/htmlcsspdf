import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type DocumentSummary, thumbnailUrl } from "./documentsApi.ts";
import { EditableName } from "./EditableName.tsx";
import { formatRelativeTime } from "./formatRelativeTime.ts";

interface DocumentCardProps {
  document: DocumentSummary;
  onRename: (document: DocumentSummary, name: string) => void;
  onDelete: (document: DocumentSummary) => void;
  renaming?: boolean;
}

/** One document in the list: preview, name, when it changed, and its actions. */
export function DocumentCard({
  document,
  onRename,
  onDelete,
  renaming,
}: DocumentCardProps) {
  const [editing, setEditing] = useState(false);
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
        {editing ? (
          <EditableName
            name={document.name}
            editing
            onEditingChange={setEditing}
            onRename={(name) => onRename(document, name)}
            saving={renaming}
            className="doc-title-field"
          />
        ) : (
          <Link to="/d/$id" params={{ id: document.id }} className="doc-title">
            {document.name}
          </Link>
        )}
        <time dateTime={new Date(document.updatedAt).toISOString()} className="doc-time">
          Edited {formatRelativeTime(document.updatedAt)}
        </time>
      </div>

      <div className="doc-actions">
        <button type="button" data-variant="ghost" onClick={() => setEditing(true)}>
          Rename
        </button>
        <button type="button" data-variant="danger" onClick={() => onDelete(document)}>
          Delete
        </button>
      </div>
    </li>
  );
}

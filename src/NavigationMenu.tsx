import { Link } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { signOut, useSession } from "./authClient.ts";
import { type DocumentSummary, fetchDocuments } from "./documentsApi.ts";
import { useServerUser } from "./useServerUser.ts";

interface NavigationMenuProps {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
  /** Highlighted in the recent list, when the editor has one open. */
  currentDocumentId?: string;
}

/** How many recent documents the menu lists before deferring to /docs. */
const RECENT_LIMIT = 8;

/**
 * The left navigation panel: who is signed in, where to go, and recent work.
 *
 * A grid column rather than an overlay, so opening it makes room instead of
 * covering the editor — the panel and the work can be read at once, and
 * nothing underneath is hidden. Not a `<dialog>` for the same reason: this
 * does not take over the page, so it must not trap focus or need dismissing.
 */
export function NavigationMenu({
  open,
  onClose,
  onSignIn,
  currentDocumentId,
}: NavigationMenuProps) {
  const { data: clientSession, isPending } = useSession();
  const serverUser = useServerUser();
  const user = isPending ? serverUser : (clientSession?.user ?? null);

  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Fetched on open rather than kept in sync: the list is only visible here,
  // and it should reflect saves made since the page loaded.
  useEffect(() => {
    if (!open || !user) return;

    let cancelled = false;
    setLoadFailed(false);
    fetchDocuments()
      .then((all) => {
        if (!cancelled) setDocuments(all.slice(0, RECENT_LIMIT));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open, user]);

  function handleSignOut() {
    void signOut();
    onClose();
  }

  return (
    // `inert` while closed, so the collapsed panel is not focusable or read by
    // a screen reader — it is still in the DOM only so its width can animate.
    <nav
      className="nav-panel"
      aria-label="Navigation"
      data-open={open || undefined}
      inert={!open}
    >
      {/* Built only while open. Keeping the contents mounted was tried and
          made things worse: with a permanently 17rem-wide child, the grid
          column stopped animating in either direction. `inert` above keeps the
          collapsed panel out of the tab order in the meantime. */}
      {open && (
        <div className="nav-body">
          {user ? (
            <div className="nav-account">
              <span className="nav-email" title={user.email}>
                {user.email}
              </span>
              <button type="button" data-variant="ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="nav-account">
              <span className="nav-email">Not signed in</span>
              <button type="button" data-variant="ghost" onClick={onSignIn}>
                Sign in
              </button>
            </div>
          )}

          <ul className="nav-links">
            <li>
              <Link to="/" className="nav-link" onClick={onClose}>
                <Plus size={16} aria-hidden="true" />
                New document
              </Link>
            </li>
            <li>
              <Link to="/docs" className="nav-link" onClick={onClose}>
                <FileText size={16} aria-hidden="true" />
                My documents
              </Link>
            </li>
          </ul>

          {user && (
            <div className="nav-recent">
              <h2 className="nav-heading">Recent</h2>
              <RecentList
                documents={documents}
                failed={loadFailed}
                currentDocumentId={currentDocumentId}
                onNavigate={onClose}
              />
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

interface RecentListProps {
  documents: DocumentSummary[] | null;
  failed: boolean;
  currentDocumentId?: string;
  onNavigate: () => void;
}

/** The recent documents, and the several states that list can be in. */
function RecentList({
  documents,
  failed,
  currentDocumentId,
  onNavigate,
}: RecentListProps) {
  if (failed) return <p className="nav-empty">Could not load your documents.</p>;
  if (documents === null) return <p className="nav-empty">Loading…</p>;
  if (documents.length === 0) return <p className="nav-empty">Nothing saved yet.</p>;

  return (
    <ul className="nav-links">
      {documents.map((document) => (
        <li key={document.id}>
          <Link
            to="/d/$id"
            params={{ id: document.id }}
            className="nav-link"
            onClick={onNavigate}
            aria-current={document.id === currentDocumentId ? "page" : undefined}
          >
            <FileText size={16} aria-hidden="true" />
            <span className="nav-link-label">{document.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

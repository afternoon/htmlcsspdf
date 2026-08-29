import { Menu } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NavigationMenu } from "./NavigationMenu.tsx";

interface AppShellProps {
  /** Sits beside the brand: a document name, or a page label. */
  title: ReactNode;
  /** The page's own controls, at the right of the header. */
  actions?: ReactNode;
  /** Highlighted in the panel's recent list. */
  currentDocumentId?: string;
  onSignIn: () => void;
  children: ReactNode;
}

/**
 * The frame every page sits in: the header, the navigation panel, and the
 * column layout that makes room for it.
 *
 * Owning the panel here rather than in each page is what puts it on every
 * route — it was previously built inside the editor, so /docs simply had no
 * way to reach it.
 */
export function AppShell({
  title,
  actions,
  currentDocumentId,
  onSignIn,
  children,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape closes the panel. It is not a dialog — it displaces content rather
  // than covering it — so nothing gives it that behaviour for free, and a
  // panel with no keyboard dismissal would strand anyone not using a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleMenu() {
    setMenuOpen((open) => !open);
  }

  return (
    <div className="app">
      <header className="topbar">
        {/* The icon sits outside `.brand` deliberately: that row aligns its
            children on the text baseline, and a graphic has none — including
            it dragged the wordmark off centre in the bar. */}
        <button
          type="button"
          className="menu-button"
          onClick={toggleMenu}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          <Menu size={18} aria-hidden="true" />
        </button>

        <div className="brand">
          htmlcsspdf
          {title}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </header>

      <div className={`workspace ${menuOpen ? "" : "closed"}`}>
        <NavigationMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onSignIn={onSignIn}
          currentDocumentId={currentDocumentId}
        />
        {children}
      </div>
    </div>
  );
}

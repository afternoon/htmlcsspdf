import { X } from "lucide-react";
import { useEffect } from "react";
import type { ToastMessage } from "./useToast.ts";

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

/** Long enough to read a sentence, short enough not to sit over the work. */
const TOAST_DURATION_MS = 6000;

/**
 * A transient message, floating over the page.
 *
 * The region stays mounted and empty rather than being rendered on demand, so
 * a screen reader has something to announce into when a message lands — a live
 * region added at the same moment as its content is frequently missed. It is
 * `hidden` while empty, the same as the editor's error overlay, which keeps an
 * empty box from sitting over the corner of the page.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  // Keyed on the id, not the message, so a repeat of the same text restarts
  // the countdown instead of inheriting the tail of the previous one.
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div className="toast-region" role="alert" hidden={!toast}>
      {toast ? (
        <div className="toast">
          <span className="toast-text">{toast.text}</span>
          <button
            type="button"
            className="toast-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss message"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

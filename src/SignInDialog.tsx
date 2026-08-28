import { useEffect, useRef } from "react";
import { signInWithGoogle } from "./authClient.ts";

interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Sign-in prompt.
 *
 * A native <dialog>, so focus trapping, Escape, the backdrop, and inert
 * background content all come from the platform rather than being rebuilt.
 */
export function SignInDialog({ open, onClose }: SignInDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    // showModal() is imperative and throws if called twice, so mirror the prop
    // rather than calling it from a handler.
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function handleSignIn() {
    // Full-page redirect to Google. The draft is already in localStorage, so
    // it survives the round trip.
    void signInWithGoogle();
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      onClose={onClose}
      aria-labelledby="signin-title"
    >
      <div className="dialog-body">
        <h2 id="signin-title">Sign in to save</h2>
        <p className="dialog-text">
          Your document is kept while you sign in — you'll come straight back to it.
        </p>

        <button type="button" className="provider" onClick={handleSignIn}>
          <GoogleMark />
          Continue with Google
        </button>

        <button type="button" data-variant="ghost" onClick={onClose}>
          Not now
        </button>
      </div>
    </dialog>
  );
}

/** Google's mark, inline so it needs no network request. Decorative: the
 *  button's own text is the accessible name. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

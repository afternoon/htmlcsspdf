import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SignInDialog } from "./SignInDialog.tsx";

/** Shown when a signed-out visitor reaches a page that needs an account. */
export function SignedOut() {
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Link to="/" className="brand-link">
            htmlcsspdf
          </Link>
        </div>
      </header>

      <main className="page-body">
        <div className="empty">
          <h1>Sign in to see your documents</h1>
          <p>Documents you save are private to your account.</p>
          <button type="button" onClick={() => setSignInOpen(true)}>
            Sign in
          </button>
        </div>
      </main>

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}

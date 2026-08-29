import { useState } from "react";
import { AppShell } from "./AppShell.tsx";
import { SignInDialog } from "./SignInDialog.tsx";

/** Shown when a signed-out visitor reaches a page that needs an account. */
export function SignedOut() {
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <>
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />

      <AppShell
        title={<span className="status">documents</span>}
        onSignIn={() => setSignInOpen(true)}
      >
        <main className="page-body">
          <div className="empty">
            <h1>Sign in to see your documents</h1>
            <p>Documents you save are private to your account.</p>
            <button type="button" onClick={() => setSignInOpen(true)}>
              Sign in
            </button>
          </div>
        </main>
      </AppShell>
    </>
  );
}

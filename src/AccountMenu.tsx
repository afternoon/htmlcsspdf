import { Link } from "@tanstack/react-router";
import { signOut, useSession } from "./authClient.ts";

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing while the session resolves rather than assuming signed-out:
 * flashing "Sign in" at someone who is already signed in reads as being logged
 * out unexpectedly.
 */
export function AccountMenu({ onSignIn }: { onSignIn: () => void }) {
  const { data: session, isPending } = useSession();

  if (isPending) return <div className="account" aria-hidden="true" />;

  if (!session) {
    return (
      <button type="button" data-variant="ghost" onClick={onSignIn}>
        Sign in
      </button>
    );
  }

  function handleSignOut() {
    void signOut();
  }

  return (
    <div className="account">
      <Link to="/docs" className="account-link">
        My documents
      </Link>
      <span className="account-email" title={session.user.email}>
        {session.user.email}
      </span>
      <button type="button" data-variant="ghost" onClick={handleSignOut}>
        Sign out
      </button>
    </div>
  );
}

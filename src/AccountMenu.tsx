import { Link } from "@tanstack/react-router";
import { signOut, useSession } from "./authClient.ts";
import { useServerUser } from "./useServerUser.ts";

/**
 * Who is signed in, and the way out.
 *
 * The root loader resolves the session on the server, so the signed-in state
 * is present on first paint. The client store takes over once it has loaded —
 * it is the one that reacts to signing in or out — but until then the
 * server's answer stands, which is what stops the header flashing "Sign in"
 * at someone who is already signed in.
 */
export function AccountMenu({ onSignIn }: { onSignIn: () => void }) {
  const { data: clientSession, isPending } = useSession();
  const serverUser = useServerUser();
  const user = isPending ? serverUser : (clientSession?.user ?? null);

  if (!user) {
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
      <span className="account-email" title={user.email}>
        {user.email}
      </span>
      <button type="button" data-variant="ghost" onClick={handleSignOut}>
        Sign out
      </button>
    </div>
  );
}

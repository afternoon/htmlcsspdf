import { signInWithGoogle } from "./authClient.ts";

interface LoginPageProps {
  /** True when the provider sent us here mid-authorization. */
  authorizing: boolean;
}

/**
 * The sign-in page the OAuth flow redirects to.
 *
 * The app's own sign-in is a dialog, which cannot serve this purpose: the
 * provider needs somewhere to *send* an unauthenticated browser in the middle
 * of an authorization request, and that has to be a URL. So this exists
 * alongside the dialog rather than replacing it.
 *
 * There is nothing here to resume the authorization with, and that is by
 * design: the pending request rides along inside the signed query the provider
 * put in this page's URL, which the auth client attaches to the sign-in call
 * and which travels to Google in the state parameter. The provider picks the
 * flow back up the moment a session cookie exists — so this page only has to
 * sign the user in, and never learns where they are going next.
 */
export function LoginPage({ authorizing }: LoginPageProps) {
  return (
    <div className="page">
      <main className="page-body">
        <div className="empty">
          <h1>Sign in to htmlcsspdf</h1>
          <p>
            {authorizing
              ? "An app is asking to work with your documents. Sign in, and you can choose what to allow on the next screen."
              : "Documents you save are private to your account."}
          </p>

          <button
            type="button"
            className="provider"
            onClick={() => void signInWithGoogle("/")}
          >
            Continue with Google
          </button>

          <a href="/" className="button-link">
            Back to the editor
          </a>
        </div>
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  fetchPublicClient,
  type PublicClient,
  respondToConsent,
} from "./oauthConsent.ts";

interface ConsentPageProps {
  /** The client asking, from the query string the provider redirected with. */
  clientId: string;
  /** Space-delimited scopes the client asked for (RFC 6749). */
  scope: string;
}

/**
 * What each scope actually lets an app do, in the user's terms.
 *
 * Written as consequences rather than as scope names: "documents:write" tells
 * someone nothing, and a consent screen nobody can read is a consent screen
 * that gets clicked through.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "documents:read": "Read your documents, including their HTML and CSS",
  "documents:write": "Create, edit, rename and delete your documents",
  offline_access: "Keep working after you close this window, until you disconnect it",
};

/**
 * The OAuth consent screen.
 *
 * This is the only place a person decides whether an agent gets to touch their
 * documents, which makes it the whole trust boundary for the MCP endpoint —
 * client registration is open, so being registered proves nothing at all. That
 * is why the name and link below are labelled as the client's own claims: an
 * app can register under any name it likes, and a consent screen that presents
 * a self-asserted name as established fact is actively misleading.
 */
export function ConsentPage({ clientId, scope }: ConsentPageProps) {
  const [client, setClient] = useState<PublicClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scopes = scope.split(" ").filter(Boolean);

  useEffect(() => {
    let current = true;
    fetchPublicClient(clientId)
      // A failure here is not fatal: the decision can still be made from the
      // scopes and the client id, which is more than the name adds.
      .then((found) => current && setClient(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [clientId]);

  async function respond(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      // A full-page navigation, not a router one: the destination belongs to
      // the client that started this, and is not a route of ours.
      window.location.href = await respondToConsent(accept);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not answer the request.");
      setBusy(false);
    }
  }

  const name = client?.client_name?.trim();

  return (
    <div className="page">
      <main className="page-body">
        <div className="empty">
          <h1>{name ? `${name} wants access` : "An app wants access"}</h1>

          <p>
            {name ? (
              <>
                It identifies itself as <strong>{name}</strong>, which we have not
                verified.{" "}
              </>
            ) : null}
            Only continue if you started this yourself.
          </p>

          {error ? <p className="page-error">{error}</p> : null}

          <ul className="scope-list">
            {scopes.map((granted) => (
              <li key={granted}>{SCOPE_DESCRIPTIONS[granted] ?? granted}</li>
            ))}
          </ul>

          <p className="consent-client">
            Client ID <code>{clientId}</code>
            {client?.client_uri ? (
              <>
                {" · "}
                {/* No target=_blank: opening an unverified URL in a new tab
                    leaves this page live behind it, and the link is exactly
                    the thing we are telling the user not to trust. */}
                <a href={client.client_uri} rel="noreferrer nofollow external">
                  {client.client_uri}
                </a>
              </>
            ) : null}
          </p>

          <div className="dialog-actions">
            <button
              type="button"
              data-variant="ghost"
              disabled={busy}
              onClick={() => void respond(false)}
            >
              Deny
            </button>
            <button type="button" disabled={busy} onClick={() => void respond(true)}>
              {busy ? "Working…" : "Allow"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

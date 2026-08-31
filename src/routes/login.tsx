import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "../LoginPage.tsx";

/**
 * `/login` — where the OAuth provider sends an unauthenticated browser.
 *
 * Configured as the provider's `loginPage`, so the path is part of the auth
 * contract rather than a free choice.
 *
 * The provider appends the whole signed authorization request to the URL. None
 * of it is read here — `authClient` forwards it on the sign-in call — but
 * `validateSearch` has to let it through, because a route that strips unknown
 * parameters would strip the thing the flow depends on.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => search,
  component: LoginRoute,
});

function LoginRoute() {
  const search = Route.useSearch() as Record<string, unknown>;
  // A signature means the provider sent us, rather than the user arriving on
  // their own. It is only used to choose which sentence to show.
  return <LoginPage authorizing={typeof search.sig === "string"} />;
}

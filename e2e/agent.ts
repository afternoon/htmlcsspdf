import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import {
  auth,
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { approveAuthorization } from "./approve.ts";

/**
 * An agent, built out of the real MCP client SDK.
 *
 * The point of using the SDK rather than hand-rolled requests is that the
 * client half stops being our own opinion. Discovery, dynamic registration,
 * PKCE, the resource indicator, the token exchange and the 2026-07-28 request
 * envelope are all performed by the same code an actual agent runs — so the
 * test fails if we are interoperable only with ourselves.
 *
 * The single substitution is `redirectToAuthorization`: instead of opening a
 * browser, it drives `approve.ts`.
 */

export interface AgentOptions {
  baseUrl: string;
  /** The session of the person who will approve the request. */
  cookie: string;
  /**
   * Scopes to ask for, space-delimited.
   *
   * Omit to let the flow run the way an agent's actually does — the transport
   * reads the scopes out of the endpoint's `WWW-Authenticate` challenge and
   * requests those. Pass a value only to model a client that deliberately asks
   * for less than it is offered; the challenge-driven path can only ever widen
   * (the SDK unions), so a narrower grant has to be requested up front.
   */
  scope?: string;
  /**
   * The callback to register, for modelling a client that is not a web app.
   *
   * Defaults to an https URI. A client on a command line registers an http
   * loopback one instead — `claude mcp add` uses
   * `http://localhost:<port>/callback` — and the redirect URIs are the whole
   * of what `application_type` is decided by, on both sides. So an agent that
   * never varies this only ever exercises the web client's path through
   * registration, authorization and the token exchange.
   */
  redirectUrl?: string;
  /**
   * Which protocol era to speak. Defaults to the 2026-07-28 pin.
   *
   * `"legacy"` models a client that never negotiates — the SDK's default, and
   * what `claude mcp list` puts on the wire. The endpoint serves both, so both
   * are worth a test: this is the option that says which one is under test
   * rather than leaving it to whatever the SDK defaults to next.
   */
  era?: "modern" | "legacy";
}

/**
 * Keeps credentials in memory for one connection.
 *
 * A real agent persists these; a test wants each connection to start with no
 * client registration and no tokens, so that registration and the full
 * authorization run every time rather than being skipped on a cache hit.
 */
class ScriptedAuthProvider implements OAuthClientProvider {
  #client: StoredOAuthClientInformation | undefined;
  #tokens: StoredOAuthTokens | undefined;
  #verifier = "";
  #discovery: OAuthDiscoveryState | undefined;
  /** Set by the scripted approval, read by `finishAuth`. */
  authorization: { code: string; iss?: string } | undefined;

  constructor(private readonly options: AgentOptions & { decision?: "allow" | "deny" }) {}

  // Never actually visited: the approval step intercepts the redirect. It must
  // still be a URI the provider will register — https by default, which is
  // what a web client registers; `redirectUrl` overrides it with the loopback
  // callback a client running on somebody's machine uses.
  get redirectUrl() {
    return this.options.redirectUrl ?? "https://agent.e2e.test/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "E2E Agent",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // Omitted when the agent has not asked for anything in particular; the
      // scopes it ends up requesting come from the challenge either way.
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    };
  }

  clientInformation() {
    return this.#client;
  }

  saveClientInformation(information: StoredOAuthClientInformation) {
    this.#client = information;
  }

  tokens() {
    return this.#tokens;
  }

  saveTokens(tokens: StoredOAuthTokens) {
    this.#tokens = tokens;
  }

  saveCodeVerifier(verifier: string) {
    this.#verifier = verifier;
  }

  codeVerifier() {
    return this.#verifier;
  }

  // SEP-2352: records which authorization server issued the redirect, so the
  // code and PKCE verifier cannot be redeemed against a different one. The SDK
  // warns when a provider omits it; a test agent that ignored a security
  // callback would be a poor model of a real one.
  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.#discovery = state;
  }

  discoveryState() {
    return this.#discovery;
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    this.authorization = await approveAuthorization(authorizationUrl, this.options);
  }
}

const AGENT_INFO = { name: "e2e-agent", version: "1.0.0" };

/**
 * Pin the client to the 2026-07-28 era.
 *
 * A pin rather than `'auto'`: the probe would reach the same era against this
 * endpoint, but silently, so a regression that dropped modern serving would
 * still pass as a fall back to 2025. Pinned, it fails.
 */
const MODERN = { versionNegotiation: { mode: { pin: "2026-07-28" } } } as const;

/**
 * A client that never negotiates: the plain 2025 handshake, byte-identical to
 * one written before the era existed.
 *
 * `mode: 'legacy'` is the SDK's own default, so this is what a client that has
 * not opted into negotiation puts on the wire — including, as it turned out,
 * the one this endpoint most needed to serve.
 */
const LEGACY = { versionNegotiation: { mode: "legacy" } } as const;

export interface ConnectedAgent {
  client: Client;
  close: () => Promise<void>;
  /** The access token the flow produced, for inspecting its claims. */
  accessToken: string;
}

/**
 * Run the whole flow and return a connected client.
 *
 * The first `connect` is expected to fail: the endpoint answers 401, the
 * transport reads the challenge, discovers the authorization server, registers,
 * and hands us an authorization URL. That failure *is* the discovery step
 * working, so it is awaited rather than avoided.
 */
export async function connectAgent(options: AgentOptions): Promise<ConnectedAgent> {
  const authProvider = new ScriptedAuthProvider(options);
  const url = new URL(`${options.baseUrl}/api/mcp`);

  if (options.scope) {
    await authorizeWithScope(authProvider, url, options.scope);
  } else {
    await authorizeFromChallenge(authProvider, url);
  }

  const transport = new StreamableHTTPClientTransport(url, { authProvider });
  const client = new Client(AGENT_INFO, options.era === "legacy" ? LEGACY : MODERN);
  await client.connect(transport);

  const tokens = await authProvider.tokens();
  if (!tokens?.access_token) throw new Error("No access token after authorization.");

  return {
    client,
    accessToken: tokens.access_token,
    close: () => client.close(),
  };
}

/**
 * The path a real agent takes: connect, be refused, and follow the refusal.
 *
 * The first connection is *expected* to fail. That failure is the endpoint
 * answering 401 with a challenge, the transport discovering the authorization
 * server from it, registering, and producing an authorization URL — so it is
 * the discovery mechanism working, not a problem to route around. The scopes
 * requested are whatever the challenge advertised, which is what makes this
 * worth exercising: it is the only path that proves the advertisement is right.
 */
async function authorizeFromChallenge(
  authProvider: ScriptedAuthProvider,
  url: URL,
): Promise<void> {
  const transport = new StreamableHTTPClientTransport(url, { authProvider });
  const client = new Client(AGENT_INFO, MODERN);

  try {
    await client.connect(transport);
    throw new Error("The MCP endpoint accepted an unauthenticated connection.");
  } catch (cause) {
    if (!authProvider.authorization) throw cause;
  }

  const { code, iss } = authProvider.authorization as { code: string; iss?: string };
  await transport.finishAuth(code, iss);
  await transport.close();
}

/** Authorize for an explicit scope, without going through a challenge first. */
async function authorizeWithScope(
  authProvider: ScriptedAuthProvider,
  url: URL,
  scope: string,
): Promise<void> {
  await auth(authProvider, { serverUrl: url, scope });

  const { code, iss } = authProvider.authorization ?? {};
  if (!code) throw new Error("Authorization did not produce a code.");

  await auth(authProvider, { serverUrl: url, scope, authorizationCode: code, iss });
}

/** The `sub`, `aud` and `scope` an access token carries, without verifying it. */
export function tokenClaims(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new Error("Access token is not a JWT.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

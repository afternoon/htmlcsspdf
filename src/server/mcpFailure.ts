/**
 * What `/api/mcp` answers when something outside the protocol breaks.
 *
 * Without this, an exception escaping the route is caught by the server
 * runtime, which answers `{"status":500,"unhandled":true,"message":"HTTPError"}`
 * — the message deliberately withheld, since a framework cannot know what is
 * safe to say. An agent shows that body to whoever is watching, so a real
 * failure with a real message arrived as four words that name nothing.
 *
 * That is exactly how the JWKS failure behind the
 * `global_fetch_strictly_public` flag presented: token verification fetches
 * the key set over HTTP, and a non-OK answer throws a plain `Error` that
 * `requireMcpAuth` cannot classify as an authorization problem, so it is
 * re-thrown rather than turned into a challenge. Diagnosing it took a reading
 * of three libraries, because the response said nothing and the logs were the
 * only place the message existed.
 *
 * So the endpoint says it itself, in the envelope an MCP client already knows
 * how to read.
 */

/**
 * `-32603`, JSON-RPC's internal error.
 *
 * Not an authorization code: a client that reads a 401 re-runs the whole
 * OAuth flow, and sending it back through sign-in and consent for a fault on
 * this side would waste a person's time and end in the same failure. 503 says
 * the same thing at the HTTP layer — the token is fine, the server is not.
 */
const INTERNAL_ERROR = -32603;

/**
 * The message, kept to one line.
 *
 * The text comes from our own dependencies rather than from the request, and
 * naming it is the entire point — "Jwks failed: Not Found" is a diagnosis
 * where "HTTPError" is a shrug. Stacks stay in the logs.
 */
function failureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `The MCP endpoint could not serve this request: ${detail}`;
}

/**
 * Run `work`, answering an escaped exception as JSON-RPC rather than letting
 * the runtime mask it.
 *
 * Errors are logged as well as answered: `observability` is on for this
 * Worker, so `console.error` is what `wrangler tail` and the dashboard show,
 * and the response carries no stack.
 */
export async function withMcpFailureResponse(
  work: () => Promise<Response>,
): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    console.error("MCP request failed:", error);
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: INTERNAL_ERROR, message: failureMessage(error) },
        id: null,
      },
      { status: 503 },
    );
  }
}

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { withMcpFailureResponse } from "./mcpFailure.ts";

/**
 * The behaviour under test is what an agent's operator sees when the endpoint
 * breaks for a reason that is not the protocol's and not the token's.
 *
 * `"Jwks failed: Not Found"` is the real message: token verification fetches
 * the authorization server's key set over HTTP, and a non-OK answer throws a
 * plain `Error` that `requireMcpAuth` re-throws rather than turning into a
 * challenge. Unwrapped, the runtime replaced it with
 * `{"status":500,"unhandled":true,"message":"HTTPError"}`, which is what an
 * MCP client printed and what made a one-line cause take a morning to find.
 */

const jwksFailure = () => Promise.reject(new Error("Jwks failed: Not Found"));

describe("an MCP request that fails outside the protocol", () => {
  it("passes a successful response through untouched", async () => {
    const ok = new Response("body", { status: 200 });
    expect(await withMcpFailureResponse(async () => ok)).toBe(ok);
  });

  it("answers JSON-RPC, naming what went wrong", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await withMcpFailureResponse(jwksFailure);
    const body = (await response.json()) as {
      jsonrpc: string;
      error: { code: number; message: string };
      id: null;
    };

    // 503, not 401: the token is fine, so a client that answered a challenge
    // here would run a person through sign-in and consent to reach the same
    // failure.
    expect(response.status).toBe(503);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toContain("Jwks failed: Not Found");
    expect(body.id).toBeNull();
  });

  it("logs the error, since the response carries no stack", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await withMcpFailureResponse(jwksFailure);

    expect(logged).toHaveBeenCalledWith("MCP request failed:", expect.any(Error));
  });

  it("says something useful even when what was thrown is not an Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await withMcpFailureResponse(() => Promise.reject("just a string"));
    const body = (await response.json()) as { error: { message: string } };

    expect(body.error.message).toContain("just a string");
  });
});

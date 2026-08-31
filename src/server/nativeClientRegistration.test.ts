// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inferredApplicationType } from "./nativeClientRegistration.ts";

/**
 * The first case is the one that matters: a client that registers a loopback
 * callback and never mentions `application_type`, which is what a client
 * written against RFC 7591 alone does and what the OAuth provider's `"web"`
 * default refuses. The rest hold the inference to SEP-837's rule, which is the
 * same one the MCP client SDK applies when it fills the field in itself — the
 * two disagreeing would be worse than either.
 */

/** A registration reduced to the two fields the inference reads. */
function registration(...redirectUris: string[]) {
  return { redirect_uris: redirectUris };
}

describe("inferring application_type from redirect URIs", () => {
  it("reads an http loopback callback as a native client", () => {
    expect(inferredApplicationType(registration("http://localhost:60369/callback"))).toBe(
      "native",
    );
  });

  it("accepts the other loopback spellings", () => {
    for (const uri of [
      "http://127.0.0.1:3118/callback",
      "http://[::1]:3118/callback",
      "https://localhost:3118/callback",
    ]) {
      expect(inferredApplicationType(registration(uri))).toBe("native");
    }
  });

  it("reads a private-use scheme as a native client", () => {
    expect(inferredApplicationType(registration("com.example.app:/callback"))).toBe(
      "native",
    );
  });

  // Ambiguous under OIDC, and native is the reading that lets both URIs stand:
  // the provider allows a native client ordinary https redirects, but allows
  // no web client a loopback one.
  it("reads a mixed set as native", () => {
    expect(
      inferredApplicationType(
        registration("https://agent.test/callback", "http://localhost:60369/callback"),
      ),
    ).toBe("native");
  });

  it("leaves a client that stated its type alone", () => {
    expect(
      inferredApplicationType({
        application_type: "web",
        redirect_uris: ["http://localhost:60369/callback"],
      }),
    ).toBeUndefined();
  });

  it("leaves an https redirect as the web registration it looks like", () => {
    expect(
      inferredApplicationType(registration("https://agent.test/callback")),
    ).toBeUndefined();
  });

  it("does not infer for an http host that is merely loopback-ish", () => {
    expect(
      inferredApplicationType(registration("http://localhost.evil.test/cb")),
    ).toBeUndefined();
    expect(inferredApplicationType(registration("http://127.0.0.2/cb"))).toBeUndefined();
  });

  it("says nothing about a registration with no usable redirect URIs", () => {
    expect(inferredApplicationType({})).toBeUndefined();
    expect(inferredApplicationType(registration())).toBeUndefined();
    expect(inferredApplicationType({ redirect_uris: [42] })).toBeUndefined();
    expect(inferredApplicationType(registration("not a uri"))).toBeUndefined();
  });
});

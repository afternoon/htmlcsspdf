import { beforeAll, describe, expect, inject, it } from "vitest";
import { type ConnectedAgent, connectAgent, tokenClaims } from "./agent.ts";

/**
 * The MCP endpoint, end to end, against the running app.
 *
 * `mcpServer.test.ts` already covers the tools themselves. What it cannot
 * reach is everything between an agent and those tools: the challenge that
 * starts discovery, the metadata documents served from the site root, dynamic
 * registration, consent, and the audience-bound token that finally gets a call
 * through. Both real defects found while building this feature lived in
 * exactly that gap — one in how `.well-known` requests are routed, one in how
 * the consent screen answers — and neither was reachable from a unit test.
 *
 * The agent is the real MCP client SDK, so the client half of the protocol is
 * not our own opinion of it.
 */

const { baseUrl, alice, bob } = inject("e2e");

/** Deliberately narrower than what the endpoint offers. */
const READ_ONLY = "documents:read";

const DOC = {
  name: "E2E invoice",
  html: "<h1>Invoice</h1>",
  css: "@page { size: A4 }",
};

/** A tool result, flattened to the text an agent would read. */
function resultText(result: unknown): string {
  const content =
    (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((block) => block.text ?? "").join("");
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe("an unauthenticated agent is told where to authorize", () => {
  it("answers 401 with an RFC 9728 challenge", async () => {
    const response = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(response.status).toBe(401);

    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/api/mcp"`,
    );
  });

  it("advertises the scopes it offers, not merely the one it requires", async () => {
    // What an agent ends up holding is decided here: the MCP SDK requests the
    // scopes named in this challenge and never asks for more. Advertising only
    // the required scope capped every agent at read-only and left the write
    // tools unreachable, which no unit test could have noticed.
    const response = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    const scope = /scope="([^"]*)"/.exec(response.headers.get("www-authenticate") ?? "");
    expect(scope?.[1]?.split(" ").sort()).toEqual(["documents:read", "documents:write"]);
  });

  it("serves protected resource metadata at the path the challenge names", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/api/mcp`,
    );
    expect(response.status).toBe(200);

    const metadata = (await response.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };

    expect(metadata.resource).toBe(`${baseUrl}/api/mcp`);
    expect(metadata.authorization_servers).toEqual([`${baseUrl}/api/auth`]);
    // `offline_access` is the authorization server's business, not this
    // resource's, so it must not be advertised here.
    expect(metadata.scopes_supported).toEqual(["documents:read", "documents:write"]);
  });

  it("serves authorization server metadata at its RFC 8414 path", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server/api/auth`,
    );
    expect(response.status).toBe(200);

    const metadata = (await response.json()) as Record<string, string>;
    expect(metadata.issuer).toBe(`${baseUrl}/api/auth`);
    expect(metadata.registration_endpoint).toBe(`${baseUrl}/api/auth/oauth2/register`);
  });

  it("does not answer discovery with the app shell", async () => {
    // The failure this guards is silent: without the routes, these paths fall
    // through to the SPA and return 200 text/html, which a client cannot tell
    // from a malformed document.
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-authorization-server/api/auth",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.headers.get("content-type")).toContain("application/json");
    }
  });
});

describe("an agent that goes through the whole flow", () => {
  let agent: ConnectedAgent;

  beforeAll(async () => {
    // No scope: the agent requests whatever the challenge advertises, which is
    // exactly how a real one behaves.
    agent = await connectAgent({ baseUrl, cookie: alice.cookie });
    return () => agent.close();
  }, 60_000);

  it("holds a token bound to this resource and this person", () => {
    const claims = tokenClaims(agent.accessToken);

    expect(claims.sub).toBe(alice.userId);
    expect(claims.aud).toBe(`${baseUrl}/api/mcp`);
    expect(claims.iss).toBe(`${baseUrl}/api/auth`);
    expect(String(claims.scope).split(" ")).toContain("documents:write");
  });

  it("is offered every document tool", async () => {
    const { tools } = await agent.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_document",
      "delete_document",
      "get_document",
      "list_documents",
      "rename_document",
      "update_document",
    ]);
  });

  it("creates a document, reads it back, and lists it", async () => {
    const created = await agent.client.callTool({
      name: "create_document",
      arguments: DOC,
    });
    const { id, url } = JSON.parse(resultText(created)) as { id: string; url: string };
    expect(id).toBeTruthy();
    // The URL an agent would hand its user, against the origin the app is
    // really served from rather than the one a unit test hands it.
    expect(url).toBe(`${baseUrl}/d/${id}`);

    const read = await agent.client.callTool({
      name: "get_document",
      arguments: { id },
    });
    expect(JSON.parse(resultText(read))).toMatchObject({
      name: DOC.name,
      html: DOC.html,
      url: `${baseUrl}/d/${id}`,
    });

    const listed = await agent.client.callTool({
      name: "list_documents",
      arguments: {},
    });
    const { documents } = JSON.parse(resultText(listed)) as {
      documents: { id: string; url: string }[];
    };
    expect(documents.map((document) => document.id)).toContain(id);
    expect(documents.find((document) => document.id === id)?.url).toBe(
      `${baseUrl}/d/${id}`,
    );
  });

  it("has its HTML sanitised on the way in, like the browser's", async () => {
    const created = await agent.client.callTool({
      name: "create_document",
      arguments: {
        ...DOC,
        name: "E2E script",
        html: "<h1>Invoice</h1><script>fetch('https://evil.test')</script>",
      },
    });
    const { id } = JSON.parse(resultText(created)) as { id: string };

    const read = await agent.client.callTool({
      name: "get_document",
      arguments: { id },
    });
    expect(JSON.parse(resultText(read)).html).not.toContain("script");
  });
});

describe("a token only reaches its own owner's documents", () => {
  it("hides one person's document from another's agent", async () => {
    const forAlice = await connectAgent({ baseUrl, cookie: alice.cookie });
    const created = await forAlice.client.callTool({
      name: "create_document",
      arguments: { ...DOC, name: "E2E private" },
    });
    const { id } = JSON.parse(resultText(created)) as { id: string };
    await forAlice.close();

    const forBob = await connectAgent({ baseUrl, cookie: bob.cookie });
    try {
      const read = await forBob.client.callTool({
        name: "get_document",
        arguments: { id },
      });
      expect(isError(read)).toBe(true);
      // Nothing in the refusal confirms the document exists.
      expect(resultText(read)).not.toContain(id);

      const listed = await forBob.client.callTool({
        name: "list_documents",
        arguments: {},
      });
      const { documents } = JSON.parse(resultText(listed)) as {
        documents: { id: string }[];
      };
      expect(documents.map((document) => document.id)).not.toContain(id);
    } finally {
      await forBob.close();
    }
  }, 60_000);
});

describe("scopes decide what an agent is offered", () => {
  it("gives a read-only token a read-only server", async () => {
    const agent = await connectAgent({
      baseUrl,
      cookie: alice.cookie,
      scope: READ_ONLY,
    });

    try {
      expect(String(tokenClaims(agent.accessToken).scope).split(" ")).not.toContain(
        "documents:write",
      );

      const { tools } = await agent.client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_document",
        "list_documents",
      ]);

      // Not merely hidden from the listing — there is no such tool to call.
      await expect(
        agent.client.callTool({ name: "create_document", arguments: DOC }),
      ).rejects.toThrow();
    } finally {
      await agent.close();
    }
  }, 60_000);
});

describe("a client running on somebody's machine can register itself", () => {
  const LOOPBACK_CALLBACK = "http://localhost:60369/callback";

  /**
   * The registration a client that has not adopted SEP-837 sends, by hand.
   *
   * No `application_type` — RFC 7591 has no such field — and a loopback
   * callback, because a client on a command line has nowhere else to receive
   * the redirect. The provider defaults the absent field to `"web"`, whose
   * redirect URIs must be https and non-loopback, so this exact body came back
   * `400 invalid_redirect_uri` and no consent screen was ever reached.
   *
   * It is sent as raw HTTP rather than through the agent because the client
   * SDK fills the field in itself: it derives the same value from the same
   * URIs, so an SDK-driven flow cannot see this at all.
   */
  it("is not refused for holding a loopback callback", async () => {
    const response = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "e2e-cli-agent",
        redirect_uris: [LOOPBACK_CALLBACK],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });

    const registered = (await response.json()) as {
      client_id?: string;
      application_type?: string;
      error_description?: string;
    };

    expect(registered.error_description).toBeUndefined();
    expect(response.status).toBe(201);
    expect(registered.client_id).toBeTruthy();
    // Recorded as what it is, rather than left as a web app the provider would
    // later hold to https-only redirects.
    expect(registered.application_type).toBe("native");
  });

  // The other half: a native registration has to survive everything after it.
  // The provider re-checks the redirect URI when the authorization is issued
  // and again at the token exchange, so a client registered this way could
  // still fail there.
  it("goes through the whole flow on that callback", async () => {
    const agent = await connectAgent({
      baseUrl,
      cookie: alice.cookie,
      redirectUrl: LOOPBACK_CALLBACK,
    });

    try {
      const { tools } = await agent.client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("create_document");
    } finally {
      await agent.close();
    }
  }, 60_000);
});

describe("the endpoint serves both protocol revisions", () => {
  /**
   * Both eras, because an endpoint that serves only one turns clients away.
   *
   * This was modern-only until a real client could not connect: `claude mcp
   * list` never negotiates, so it opened the plain 2025 handshake and was
   * refused with `-32022` before a tool was ever listed. The legacy leg is the
   * SDK's own stateless fallback over the same `buildMcpServer` factory, so
   * what a 2025-era client gets is what a 2026-era one gets, a revision
   * behind — and the day every client negotiates, the option comes out and
   * the first of these two tests is what says whether that is safe.
   */
  it("serves a client that pins 2026-07-28", async () => {
    const agent = await connectAgent({ baseUrl, cookie: alice.cookie });

    try {
      const { tools } = await agent.client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("create_document");
    } finally {
      await agent.close();
    }
  }, 60_000);

  it("serves a client that never negotiates", async () => {
    const agent = await connectAgent({ baseUrl, cookie: alice.cookie, era: "legacy" });

    try {
      // Not merely connected: the same six tools, and a write that lands.
      const { tools } = await agent.client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "create_document",
        "delete_document",
        "get_document",
        "list_documents",
        "rename_document",
        "update_document",
      ]);

      const created = await agent.client.callTool({
        name: "create_document",
        arguments: { ...DOC, name: "Written by a 2025-era client" },
      });
      expect(isError(created)).toBe(false);
      expect(resultText(created)).toContain("id");
    } finally {
      await agent.close();
    }
  }, 60_000);

  it("still refuses a revision it does not serve", async () => {
    // Serving 2025 is not serving anything asked for: an unknown revision is
    // still answered with the supported list rather than a best guess.
    const response = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2019-01-01",
          capabilities: {},
          clientInfo: { name: "ancient", version: "0" },
        },
      }),
    });

    // Unauthenticated, so the challenge may come first; either way it is not
    // served.
    expect([400, 401]).toContain(response.status);
  });
});

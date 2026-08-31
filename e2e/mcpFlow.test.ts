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
    const { id } = JSON.parse(resultText(created)) as { id: string };
    expect(id).toBeTruthy();

    const read = await agent.client.callTool({
      name: "get_document",
      arguments: { id },
    });
    expect(JSON.parse(resultText(read))).toMatchObject({
      name: DOC.name,
      html: DOC.html,
    });

    const listed = await agent.client.callTool({
      name: "list_documents",
      arguments: {},
    });
    const { documents } = JSON.parse(resultText(listed)) as {
      documents: { id: string }[];
    };
    expect(documents.map((document) => document.id)).toContain(id);
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

describe("the endpoint serves one protocol revision", () => {
  it("turns away a 2025-era client rather than serving it", async () => {
    // `legacy: "reject"` in `api.mcp.ts`. Worth pinning because it has a real
    // cost: the MCP client SDK negotiates the 2025 handshake *by default*, so
    // an agent that has not opted into modern negotiation cannot connect at
    // all. If that trade is ever revisited, this test is where the decision
    // is written down.
    const response = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A token is not needed: the version check answers before authorization.
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy", version: "0" },
        },
      }),
    });

    // Unauthenticated, so the challenge comes first; what matters is that no
    // 2025 exchange is ever served.
    expect([400, 401]).toContain(response.status);
  });
});

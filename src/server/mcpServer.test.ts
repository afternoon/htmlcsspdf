// @vitest-environment node
import {
  InMemoryTransport,
  type JSONRPCMessage,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it } from "vitest";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "./mcpResource.ts";
import { buildMcpServer } from "./mcpServer.ts";
import { ALICE, BOB, createTestDb } from "./testDatabase.ts";
import { env, resetWorkersStub } from "./workers.testStub.ts";

/**
 * The MCP surface, driven over the real protocol against the real queries and
 * the real migrations.
 *
 * Two things are worth proving here and nowhere else. First, that a token's
 * scopes decide which tools exist at all — the read/write split is only real
 * if `tools/list` reflects it. Second, that a tool call cannot reach another
 * user's document: the queries enforce that already, but the tools are a new
 * caller of them, and a new caller is exactly where an ownership check gets
 * dropped.
 *
 * Spoken through `InMemoryTransport` rather than by reaching for the server's
 * internals, so tool input schemas and result shaping are exercised the way a
 * real client would exercise them.
 */

const DOC = { name: "Invoice", html: "<h1>Hi</h1>", css: "h1 { color: red }" };

const READ_ONLY = new Set([MCP_READ_SCOPE]);
const READ_WRITE = new Set([MCP_READ_SCOPE, MCP_WRITE_SCOPE]);

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

/** A connected client, ready to make requests of a server built for one user. */
async function connect(userId: string, scopes: ReadonlySet<string>) {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer({ userId, scopes }).connect(serverSide);

  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  client.onmessage = (message: JSONRPCMessage) => {
    const answer = message as { id?: number };
    if (answer.id !== undefined) pending.get(answer.id)?.(message as never);
  };
  await client.start();

  let nextId = 0;
  const request = async (method: string, params?: unknown) => {
    const id = ++nextId;
    const answered = new Promise<Record<string, unknown>>((resolve) =>
      pending.set(id, resolve),
    );
    await client.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
    return await answered;
  };

  await request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  await client.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  } as JSONRPCMessage);

  return {
    async listTools(): Promise<string[]> {
      const answer = (await request("tools/list", {})) as {
        result: { tools: { name: string }[] };
      };
      return answer.result.tools.map((tool) => tool.name).sort();
    },
    /** The fields a tool asks a client to fill in, sorted. */
    async toolInputs(name: string): Promise<string[]> {
      const answer = (await request("tools/list", {})) as {
        result: {
          tools: {
            name: string;
            inputSchema?: { properties?: Record<string, unknown> };
          }[];
        };
      };
      const tool = answer.result.tools.find((candidate) => candidate.name === name);
      return Object.keys(tool?.inputSchema?.properties ?? {}).sort();
    },
    async call(name: string, args: Record<string, unknown>) {
      const answer = (await request("tools/call", { name, arguments: args })) as {
        result?: ToolResult;
        error?: { message: string };
      };
      if (!answer.result) throw new Error(answer.error?.message ?? "no result");

      return {
        isError: answer.result.isError,
        text: answer.result.content.map((block) => block.text).join(""),
      };
    },
    close: () => client.close(),
  };
}

/** Create a document owned by Alice and return its id. */
async function aliceDocument(): Promise<string> {
  const alice = await connect(ALICE, READ_WRITE);
  const created = await alice.call("create_document", DOC);
  await alice.close();
  return (JSON.parse(created.text) as { id: string }).id;
}

beforeEach(() => {
  resetWorkersStub();
  env.DB = createTestDb().db;
  // Thumbnail capture is handed to `waitUntil` and never awaited, so a stub
  // that does nothing is what an unavailable Browser Run looks like.
  env.THUMBNAILS = { delete: async () => {} } as unknown as R2Bucket;
});

describe("what a tool asks for", () => {
  it("does not offer an agent the browser's pacing flag", async () => {
    // `capturePreview` exists because the editor writes on every pause in
    // typing and cannot afford a browser render each time. An agent writes a
    // document at a time, so the flag is a question with no meaning here —
    // and it reached this surface once already, by being added to the schema
    // the tool is built from.
    const alice = await connect(ALICE, READ_WRITE);

    expect(await alice.toolInputs("update_document")).toEqual(["css", "html", "id"]);

    await alice.close();
  });
});

describe("scopes decide the tool surface", () => {
  it("offers only reads to a read-only token", async () => {
    const client = await connect(ALICE, READ_ONLY);
    expect(await client.listTools()).toEqual(["get_document", "list_documents"]);
    await client.close();
  });

  it("offers writes once the token carries documents:write", async () => {
    const client = await connect(ALICE, READ_WRITE);
    expect(await client.listTools()).toEqual([
      "create_document",
      "delete_document",
      "get_document",
      "list_documents",
      "rename_document",
      "update_document",
    ]);
    await client.close();
  });

  it("refuses a write a read-only token asks for anyway", async () => {
    const client = await connect(ALICE, READ_ONLY);
    await expect(client.call("create_document", DOC)).rejects.toThrow();
    await client.close();
  });
});

describe("tools stay inside the caller's own documents", () => {
  it("creates a document the owner can read back", async () => {
    const id = await aliceDocument();

    const client = await connect(ALICE, READ_ONLY);
    const read = await client.call("get_document", { id });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(read.text)).toMatchObject({ name: "Invoice", html: DOC.html });
    await client.close();
  });

  it("does not let another user read it", async () => {
    const id = await aliceDocument();

    const client = await connect(BOB, READ_ONLY);
    const read = await client.call("get_document", { id });
    expect(read.isError).toBe(true);
    // Says nothing about whether the document exists, so the reply cannot be
    // used to probe for other people's ids.
    expect(read.text).not.toContain(id);
    await client.close();
  });

  it("does not let another user update it", async () => {
    const id = await aliceDocument();

    const bob = await connect(BOB, READ_WRITE);
    expect(
      (await bob.call("update_document", { id, html: "<p>hacked</p>", css: "" })).isError,
    ).toBe(true);
    await bob.close();

    const alice = await connect(ALICE, READ_ONLY);
    expect(JSON.parse((await alice.call("get_document", { id })).text).html).toBe(
      DOC.html,
    );
    await alice.close();
  });

  it("does not let another user rename it", async () => {
    const id = await aliceDocument();

    const bob = await connect(BOB, READ_WRITE);
    expect((await bob.call("rename_document", { id, name: "stolen" })).isError).toBe(
      true,
    );
    await bob.close();

    const alice = await connect(ALICE, READ_ONLY);
    expect(JSON.parse((await alice.call("get_document", { id })).text).name).toBe(
      "Invoice",
    );
    await alice.close();
  });

  it("does not let another user delete it", async () => {
    const id = await aliceDocument();

    const bob = await connect(BOB, READ_WRITE);
    expect((await bob.call("delete_document", { id })).isError).toBe(true);
    await bob.close();

    const alice = await connect(ALICE, READ_ONLY);
    expect((await alice.call("get_document", { id })).isError).toBeFalsy();
    await alice.close();
  });

  it("lists only the caller's own documents", async () => {
    await aliceDocument();

    const bob = await connect(BOB, READ_ONLY);
    expect(JSON.parse((await bob.call("list_documents", {})).text).documents).toEqual([]);
    await bob.close();
  });
});

describe("writes go through the same sanitiser as the browser", () => {
  it("strips script from agent-supplied HTML", async () => {
    const alice = await connect(ALICE, READ_WRITE);
    const created = await alice.call("create_document", {
      ...DOC,
      html: "<h1>Hi</h1><script>fetch('https://evil.test')</script>",
    });
    const { id } = JSON.parse(created.text) as { id: string };

    const read = await alice.call("get_document", { id });
    expect(JSON.parse(read.text).html).not.toContain("script");
    await alice.close();
  });
});

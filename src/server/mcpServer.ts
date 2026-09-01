import { env, waitUntil } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  DocumentNameSchema,
  SaveDocumentSchema,
  UpdateDocumentSchema,
} from "../documentsApi.ts";
import { documentUrl } from "./appUrl.ts";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  loadDocument,
  renameDocument,
  updateDocument,
} from "./documents.ts";
import { MCP_WRITE_SCOPE } from "./mcpResource.ts";
import { captureThumbnail, thumbnailKey } from "./thumbnails.ts";

/**
 * The MCP tool surface.
 *
 * Every tool is a thin call into `documents.ts`, which means agents get
 * exactly the access the browser has and not a byte more: the same ownership
 * clause in every query, the same sanitiser on every write, the same 404 for a
 * document that belongs to someone else. There is deliberately no query here
 * that the web app does not already make.
 *
 * A server is built per request, from one verified access token, so `userId`
 * is a closed-over constant rather than an argument a tool could be made to
 * pass wrongly.
 *
 * The one thing the tools add to what `documents.ts` returns is `url`: where a
 * person opens the document in a browser. An agent that has just written a
 * document is usually about to tell someone about it, and a link it composed
 * from an id is a link it guessed. It is a field on every result that names a
 * document rather than a seventh tool, so getting it costs no round trip and
 * an agent cannot hold an id without also holding the URL for it.
 */

/** Documents are addressed by the id the create tool handed back. */
const DocumentIdSchema = z.object({
  id: z.string().min(1, "Give the id of a document you own."),
});

/**
 * What a tool says when a document is not there.
 *
 * Same wording whether the document never existed or belongs to someone else —
 * the HTTP API answers 404 for both, and a tool that distinguished them would
 * hand an agent a way to probe for other people's document ids.
 */
const NOT_FOUND = "No such document. It may have been deleted, or it may not be yours.";

/** A tool result carrying one line of text. */
function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/** A tool result reporting a failure the agent can act on. */
function failure(body: string) {
  return { ...text(body), isError: true };
}

/** A tool result carrying data, in both the shapes a client may read. */
function data(value: Record<string, unknown>) {
  return { ...text(JSON.stringify(value, null, 2)), structuredContent: value };
}

export interface McpServerOptions {
  /** The `sub` of the verified access token: whose documents these are. */
  userId: string;
  /** Scopes the token actually carries, not the ones it could have asked for. */
  scopes: ReadonlySet<string>;
}

/**
 * Build the MCP server for one request.
 *
 * The write tools are registered only when the token carries
 * `documents:write`, so `tools/list` describes what this token can do rather
 * than advertising six tools of which three always fail. An agent holding a
 * read-only token sees a read-only server, which is the honest answer and
 * needs no error path.
 */
export function buildMcpServer({ userId, scopes }: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: "htmlcsspdf", version: "1.0.0" },
    {
      instructions:
        "Documents are HTML plus CSS, rendered to PDF by htmlcsspdf. Page size " +
        "and margins come from an @page rule in the CSS; there is no other page " +
        "setup. Script, iframe, form, link and event-handler attributes are " +
        "stripped on save — write document content, not an application.",
    },
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "List the user's documents, most recently updated first. Each carries " +
        "its id and the URL a person opens it at.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const documents = await listDocuments(env.DB, userId);
      return data({
        documents: documents.map((document) => ({
          ...document,
          url: documentUrl(env, document.id),
        })),
      });
    },
  );

  server.registerTool(
    "get_document",
    {
      title: "Get a document",
      description: "Read one document's HTML and CSS, and the URL it opens at.",
      inputSchema: DocumentIdSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const document = await loadDocument(env.DB, id, userId);
      if (!document) return failure(NOT_FOUND);

      const { name, html, css, updatedAt } = document;
      return data({ id, name, url: documentUrl(env, id), html, css, updatedAt });
    },
  );

  if (!scopes.has(MCP_WRITE_SCOPE)) return server;

  server.registerTool(
    "create_document",
    {
      title: "Create a document",
      description:
        "Create a document from HTML and CSS. Returns its id, which the other " +
        "tools take, and the URL a person opens it at.",
      inputSchema: SaveDocumentSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, html, css }) => {
      const { id, revision } = await createDocument(env.DB, userId, { name, html, css });
      captureInBackground(id, userId, html, css, revision);
      return data({ id, name, url: documentUrl(env, id) });
    },
  );

  server.registerTool(
    "update_document",
    {
      title: "Update a document",
      description:
        "Replace a document's HTML and CSS. Both panes are written, so send " +
        "the whole document, not a fragment — read it first if you are editing.",
      inputSchema: UpdateDocumentSchema.extend(DocumentIdSchema.shape),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, html, css }) => {
      const saved = await updateDocument(env.DB, id, userId, { html, css });
      if (!saved) return failure(NOT_FOUND);

      captureInBackground(id, userId, html, css, saved.revision);
      return text(`Updated ${id}.`);
    },
  );

  server.registerTool(
    "rename_document",
    {
      title: "Rename a document",
      description: "Change a document's name, leaving its content alone.",
      inputSchema: DocumentIdSchema.extend({ name: DocumentNameSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, name }) => {
      const renamed = await renameDocument(env.DB, id, userId, name);
      if (!renamed) return failure(NOT_FOUND);
      return text(`Renamed ${id}.`);
    },
  );

  server.registerTool(
    "delete_document",
    {
      title: "Delete a document",
      description: "Delete a document permanently. This cannot be undone.",
      inputSchema: DocumentIdSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const deleted = await deleteDocument(env.DB, id, userId);
      if (!deleted) return failure(NOT_FOUND);

      // Mirrors DELETE /api/documents/:id: the rendered image is the user's
      // content too, and nothing could ever reach it again to reclaim it.
      // Best-effort, so a failing bucket cannot block the delete.
      await env.THUMBNAILS.delete(thumbnailKey(id)).catch(() => {});

      return text(`Deleted ${id}.`);
    },
  );

  return server;
}

/**
 * Capture a preview without making the tool call wait for it.
 *
 * Same reasoning as the HTTP routes: Browser Run is the most likely thing here
 * to fail, and a missing thumbnail must never turn a successful write into a
 * failed tool call. `waitUntil` keeps the capture alive past the response,
 * where a bare promise would be discarded when the isolate is torn down.
 */
function captureInBackground(
  id: string,
  userId: string,
  html: string,
  css: string,
  revision: number,
): void {
  waitUntil(captureThumbnail(id, userId, html, css, revision));
}

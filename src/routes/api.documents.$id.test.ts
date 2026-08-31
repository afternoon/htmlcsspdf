// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, loadDocument } from "../server/documents.ts";
import * as session from "../server/session.ts";
import { ALICE, createTestDb } from "../server/testDatabase.ts";
import * as thumbnails from "../server/thumbnails.ts";
import { env, resetWorkersStub } from "../server/workers.testStub.ts";
import { Route } from "./api.documents.$id.ts";

/**
 * Saving content, and what that costs.
 *
 * The write itself is covered by the queries it runs. What is worth pinning
 * here is the preview that follows it: a caller that says nothing gets the
 * capture saving has always done, and only one that asks explicitly goes
 * without — auto-save writes on every pause in typing, and Browser Run is
 * shared with the PDF the document exists to produce.
 */

const DOC = { name: "Invoice", html: "<h1>Hi</h1>", css: "h1 { color: red }" };
const EDITED = { html: "<h1>Edited</h1>", css: "h1 { color: blue }" };

interface Handlers {
  PUT: (context: { request: Request; params: { id: string } }) => Promise<Response>;
}

const put = (Route as unknown as { options: { server: { handlers: Handlers } } }).options
  .server.handlers.PUT;

function save(id: string, body: Record<string, unknown>) {
  return put({
    request: new Request(`http://test/api/documents/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
  });
}

let db: D1Database;
let capture: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetWorkersStub();
  db = createTestDb().db;
  env.DB = db;

  vi.spyOn(session, "withUser").mockImplementation(
    async (_request, handler) => await handler({ id: ALICE } as never),
  );
  capture = vi.spyOn(thumbnails, "captureThumbnail").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saving a document", () => {
  it("captures a preview when the caller says nothing", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    const response = await save(id, EDITED);

    expect(response.status).toBe(204);
    expect(capture).toHaveBeenCalledWith(id, ALICE, EDITED.html, EDITED.css, 2);
  });

  it("writes quietly when the caller asks it to", async () => {
    // Auto-save's half of the bargain: the content lands, the browser is left
    // alone, and the preview is asked for once the editing stops.
    const { id } = await createDocument(db, ALICE, DOC);

    const response = await save(id, { ...EDITED, capturePreview: false });

    expect(response.status).toBe(204);
    expect(capture).not.toHaveBeenCalled();

    // The content is stored either way — a quiet write is not a lesser one.
    const stored = await loadDocument(db, id, ALICE);
    expect(stored?.html).toBe(EDITED.html);
    expect(stored?.thumbnailUpdatedAt).toBeNull();
  });

  it("rejects a body it cannot read", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    const response = await save(id, { html: EDITED.html, capturePreview: "yes" });

    expect(response.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });
});

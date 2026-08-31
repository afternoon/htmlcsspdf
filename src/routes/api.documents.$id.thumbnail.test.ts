// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, markThumbnail, updateDocument } from "../server/documents.ts";
import * as session from "../server/session.ts";
import { ALICE, BOB, createTestDb } from "../server/testDatabase.ts";
import * as thumbnails from "../server/thumbnails.ts";
import { env, resetWorkersStub } from "../server/workers.testStub.ts";
import { Route } from "./api.documents.$id.thumbnail.ts";

/**
 * Asking for a preview of a stored document.
 *
 * The endpoint exists because auto-save writes far more often than a browser
 * render is worth doing, so what matters here is the three answers it gives:
 * whose document it will render, when there is nothing to render, and that the
 * content rendered comes from the database rather than from the request.
 *
 * Driven against the real queries and the real migrations. Only the two things
 * a test cannot have are stood in for — the signed-in user, and Browser Run.
 */

const DOC = { name: "Invoice", html: "<h1>Hi</h1>", css: "h1 { color: red }" };

const post = (Route as unknown as { options: { server: { handlers: Handlers } } }).options
  .server.handlers.POST;

interface Handlers {
  POST: (context: { request: Request; params: { id: string } }) => Promise<Response>;
}

/** Who the request is from; the session itself is resolved elsewhere. */
let signedInAs: string = ALICE;

function request(id: string) {
  return post({
    request: new Request(`http://test/api/documents/${id}/thumbnail`, {
      method: "POST",
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
  signedInAs = ALICE;

  vi.spyOn(session, "withUser").mockImplementation(
    async (_request, handler) => await handler({ id: signedInAs } as never),
  );
  // Browser Run is not reachable from a test, and what it does with the
  // content is its own module's business. What this file cares about is
  // whether a capture is asked for, and of what.
  capture = vi.spyOn(thumbnails, "captureThumbnail").mockResolvedValue(undefined);
});

afterEach(() => {
  // Spies outlive a test otherwise, and their call history with them.
  vi.restoreAllMocks();
});

describe("asking for a preview", () => {
  it("renders the content that is stored, not content from the caller", async () => {
    const { id, revision } = await createDocument(db, ALICE, DOC);

    const response = await request(id);

    expect(response.status).toBe(202);
    expect(capture).toHaveBeenCalledWith(id, ALICE, DOC.html, DOC.css, revision);
  });

  it("does nothing when the current revision already has one", async () => {
    // Every content write clears the capture, so a stored timestamp means the
    // image is current — and this is what stops a repeat request costing
    // browser time.
    const { id, revision } = await createDocument(db, ALICE, DOC);
    await markThumbnail(db, id, ALICE, revision);

    const response = await request(id);

    expect(response.status).toBe(204);
    expect(capture).not.toHaveBeenCalled();
  });

  it("renders the newer content after a write that cleared the capture", async () => {
    const { id, revision } = await createDocument(db, ALICE, DOC);
    await markThumbnail(db, id, ALICE, revision);
    const saved = await updateDocument(db, id, ALICE, {
      html: "<h1>Later</h1>",
      css: DOC.css,
    });

    const response = await request(id);

    expect(response.status).toBe(202);
    expect(capture).toHaveBeenCalledWith(
      id,
      ALICE,
      "<h1>Later</h1>",
      DOC.css,
      saved?.revision,
    );
  });

  it("will not render someone else's document", async () => {
    // Indistinguishable from one that does not exist, and nothing is queued:
    // a capture would put another user's content into this one's bucket key.
    const { id } = await createDocument(db, ALICE, DOC);
    signedInAs = BOB;

    const response = await request(id);

    expect(response.status).toBe(404);
    expect(capture).not.toHaveBeenCalled();
  });

  it("answers 404 for a document that does not exist", async () => {
    const response = await request("no-such-document");

    expect(response.status).toBe(404);
    expect(capture).not.toHaveBeenCalled();
  });
});

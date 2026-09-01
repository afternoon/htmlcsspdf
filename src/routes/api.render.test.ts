// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, loadDocument, markThumbnail } from "../server/documents.ts";
import * as render from "../server/render.ts";
import * as session from "../server/session.ts";
import { ALICE, BOB, createTestDb } from "../server/testDatabase.ts";
import * as thumbnails from "../server/thumbnails.ts";
import { env, resetWorkersStub, scheduled } from "../server/workers.testStub.ts";
import { Route } from "./api.render.ts";

/**
 * Rendering a PDF, and the preview image that rides along with it.
 *
 * Two things are worth pinning down here, and neither is about the PDF bytes.
 *
 * The first is the session lifecycle: Browser Run bills for as long as a
 * session exists, so the session this route opens has to be closed rather than
 * left warm, and the PDF and the preview have to share the one session instead
 * of launching two.
 *
 * The second is who a piggybacked capture is allowed to run for. The route is
 * open to anyone — previewing before signing in is the point — while a
 * thumbnail is stored per user, so the rules that gate the capture are the
 * security boundary of this file.
 *
 * Driven against the real queries and the real migrations. Browser Run is the
 * one thing stubbed, since a test cannot reach it.
 */

const DOC = { name: "Invoice", html: "<h1>Hi</h1>", css: "h1 { color: red }" };
const PDF = new Uint8Array([1, 2, 3]);

interface Handlers {
  POST: (context: { request: Request }) => Promise<Response>;
}

const post = (Route as unknown as { options: { server: { handlers: Handlers } } }).options
  .server.handlers.POST;

/** Who the request is from, or nobody. */
let signedInAs: string | null = ALICE;

function request(body: unknown) {
  return post({
    request: new Request("http://test/api/render", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  });
}

/** Settle the work `waitUntil` is holding, as the runtime would. */
async function drainBackgroundWork() {
  await Promise.all(scheduled);
}

let db: D1Database;
/** One entry per session opened, recording whether it was closed. */
let sessions: { closed: boolean }[];
let capture: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetWorkersStub();
  db = createTestDb().db;
  env.DB = db;
  // Only its presence is checked; the browser itself is stubbed below.
  env.BROWSER = {} as never;
  signedInAs = ALICE;
  sessions = [];

  vi.spyOn(session, "getSessionUser").mockImplementation(async () =>
    signedInAs ? ({ id: signedInAs } as never) : null,
  );

  // Stands in for Browser Run at the seam that owns the session, so a test can
  // count sessions and see whether each was closed.
  vi.spyOn(render, "withBrowser").mockImplementation(async (_endpoint, use) => {
    const record = { closed: false };
    sessions.push(record);
    try {
      return await use({} as never);
    } finally {
      record.closed = true;
    }
  });

  vi.spyOn(render, "withRenderedPage").mockResolvedValue(PDF as never);

  // What it does with the content is its own module's business; this file
  // cares about whether it is asked, on whose session, and for what.
  capture = vi
    .spyOn(thumbnails, "captureThumbnailWith")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the browser session", () => {
  it("is closed once the render is done", async () => {
    // The session used to be handed back with `disconnect()` and left warm for
    // ten minutes. For a tool used in occasional bursts that spends far more
    // browser time idling than it saves in launches.
    const response = await request({ html: DOC.html, css: DOC.css });
    await drainBackgroundWork();

    expect(response.status).toBe(200);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].closed).toBe(true);
  });

  it("is the same one the preview is captured on", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    await request({ html: DOC.html, css: DOC.css, documentId: id });
    await drainBackgroundWork();

    // The point of capturing here rather than on its own session: a second
    // render is cheap, a second session is not.
    expect(capture).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].closed).toBe(true);
  });

  it("stays open past the response until the preview is captured", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    let finishCapture!: () => void;
    capture.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCapture = () => resolve();
        }) as never,
    );

    // The response must not wait for the capture — that is what putting it
    // after the PDF resolves is for.
    const response = await request({ html: DOC.html, css: DOC.css, documentId: id });
    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(PDF.buffer);

    // ...but the session must still be open, or the capture would be rendering
    // against a browser that had already gone away.
    expect(sessions[0].closed).toBe(false);

    finishCapture();
    await drainBackgroundWork();
    expect(sessions[0].closed).toBe(true);
  });

  it("is closed even when the render throws", async () => {
    vi.spyOn(render, "withRenderedPage").mockRejectedValue(new Error("boom"));

    const response = await request({ html: DOC.html, css: DOC.css });
    await drainBackgroundWork();

    expect(response.status).toBe(500);
    expect(sessions[0].closed).toBe(true);
  });

  it("answers rather than hanging when no session can be opened", async () => {
    // A launch refused by the rate limit never reaches the callback, so
    // nothing inside it is left to settle the PDF.
    vi.spyOn(render, "withBrowser").mockRejectedValue(
      new Error("429 rate limit exceeded"),
    );

    const response = await request({ html: DOC.html, css: DOC.css });
    await drainBackgroundWork();

    expect(response.status).toBe(429);
  });
});

describe("the preview that rides along", () => {
  it("is captured for the caller's own document, from the rendered content", async () => {
    const { id, revision } = await createDocument(db, ALICE, DOC);

    await request({ html: "<h1>Newer</h1>", css: DOC.css, documentId: id });
    await drainBackgroundWork();

    // The content captured is what was rendered, not what is stored: it is
    // already loaded in the browser, and it is what the user is looking at.
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      id,
      ALICE,
      "<h1>Newer</h1>",
      DOC.css,
      revision,
    );
  });

  it("is skipped when no document is named", async () => {
    // An unsaved draft has no card to put a picture on.
    const response = await request({ html: DOC.html, css: DOC.css });
    await drainBackgroundWork();

    expect(response.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
  });

  it("is skipped for a signed-out caller", async () => {
    // Rendering stays open to everyone; writing a stored thumbnail does not.
    const { id } = await createDocument(db, ALICE, DOC);
    signedInAs = null;

    const response = await request({ html: DOC.html, css: DOC.css, documentId: id });
    await drainBackgroundWork();

    expect(response.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
  });

  it("will not touch someone else's document", async () => {
    // The security case for the ownership check: this endpoint takes content
    // straight from the request body, so without it anyone could put any image
    // on any card.
    const { id } = await createDocument(db, ALICE, DOC);
    signedInAs = BOB;

    const response = await request({
      html: "<h1>Mine now</h1>",
      css: "",
      documentId: id,
    });
    await drainBackgroundWork();

    // The PDF is still rendered — Bob is allowed to render whatever he likes.
    expect(response.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
  });

  it("is skipped when the current revision already has one", async () => {
    // Every content write clears the stored image, so a timestamp means this
    // revision has been captured and re-rendering it would buy nothing.
    const { id, revision } = await createDocument(db, ALICE, DOC);
    await markThumbnail(db, id, ALICE, revision);

    const response = await request({ html: DOC.html, css: DOC.css, documentId: id });
    await drainBackgroundWork();

    expect(response.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not fail the render when the capture does", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    capture.mockRejectedValue(new Error("browser quota exhausted") as never);

    const response = await request({ html: DOC.html, css: DOC.css, documentId: id });

    // The PDF was already sent before the capture ran; a missing preview is a
    // placeholder on a card, never an error the user sees.
    expect(response.status).toBe(200);
    await expect(drainBackgroundWork()).resolves.not.toThrow();
  });

  it("leaves an unnamed document alone", async () => {
    const response = await request({ html: DOC.html, css: DOC.css, documentId: "" });
    await drainBackgroundWork();

    expect(response.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not mark a document it never captured", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    signedInAs = BOB;

    await request({ html: DOC.html, css: DOC.css, documentId: id });
    await drainBackgroundWork();

    const stored = await loadDocument(db, id, ALICE);
    expect(stored?.thumbnailUpdatedAt).toBeNull();
  });
});

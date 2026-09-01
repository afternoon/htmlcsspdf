import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { loadDocument } from "../server/documents.ts";
import { withBrowser, withRenderedPage } from "../server/render.ts";
import { getSessionUser } from "../server/session.ts";
import { captureThumbnailWith } from "../server/thumbnails.ts";

interface RenderBody {
  html?: unknown;
  css?: unknown;
  documentId?: unknown;
}

const MAX_INPUT_BYTES = 2_000_000;

function errorResponse(status: number, message: string, hint?: string): Response {
  return Response.json({ error: message, hint }, { status });
}

/** Map a thrown render error onto a useful status + message for the UI. */
function classifyError(e: unknown): { status: number; message: string; hint?: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw.toLowerCase();

  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many")) {
    return {
      status: 429,
      message: "Browser Run rate limit reached.",
      hint: "The free plan allows 10 browser-minutes per day and one new browser every 20 seconds. Wait a moment and try again.",
    };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      status: 504,
      message: "Rendering timed out.",
      hint: "An external resource (font, image, stylesheet) may be slow or unreachable.",
    };
  }
  if (msg.includes("quota") || msg.includes("limit exceeded")) {
    return {
      status: 429,
      message: "Browser Run daily quota exhausted.",
      hint: "Free plan accounts get 10 browser-minutes per UTC day.",
    };
  }
  return { status: 500, message: `Render failed: ${raw}` };
}

/**
 * Whether this render should also refresh a document's preview image, and for
 * whom.
 *
 * The route itself is open to anyone, but a thumbnail is a stored, per-user
 * artefact, so the piggybacked capture is not. Three things have to hold
 * before one is worth doing, and each rules out a different mistake:
 *
 *  - the caller says which document the content belongs to;
 *  - they are signed in and that document is theirs, so an open endpoint
 *    cannot be used to overwrite the preview on someone else's card;
 *  - the stored preview is actually missing. Every content write clears it,
 *    so a timestamp means the current revision has already been captured and
 *    re-rendering it would spend browser time to store the same image.
 *
 * The content is *not* re-read from the database. The point of capturing here
 * is that this exact html and css is already loaded in a browser; what is
 * checked against the database is only whether a capture is wanted and
 * permitted. The revision comes from the stored row, so a write landing
 * mid-render makes `markThumbnail` a no-op and the image is left unmarked
 * rather than claimed as current.
 */
async function previewTarget(
  request: Request,
  documentId: unknown,
): Promise<{ documentId: string; userId: string; revision: number } | null> {
  if (typeof documentId !== "string" || !documentId) return null;

  const user = await getSessionUser(request);
  if (!user) return null;

  const document = await loadDocument(env.DB, documentId, user.id);
  if (!document) return null;
  if (document.thumbnailUpdatedAt !== null) return null;

  return { documentId, userId: user.id, revision: document.revision };
}

/**
 * Renders to PDF. Deliberately open to unauthenticated callers: previewing
 * before signing in is the point, and the Browser Run quota is a hard ceiling
 * rather than a runaway cost.
 *
 * When the caller names a document of their own that is owed a preview, the
 * webp for its card is captured on this same browser session, after the PDF
 * has been handed back. Sessions are the costly resource — a second render on
 * one already running is close to free, while a second *session* is not — so
 * the two renders that a save-and-preview needs are worth doing together.
 */
async function handleRender(request: Request): Promise<Response> {
  let body: RenderBody;
  try {
    body = (await request.json()) as RenderBody;
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }

  const html = typeof body.html === "string" ? body.html : "";
  const css = typeof body.css === "string" ? body.css : "";

  if (!html.trim() && !css.trim()) {
    return errorResponse(400, "Nothing to render — both HTML and CSS are empty.");
  }
  if (html.length + css.length > MAX_INPUT_BYTES) {
    return errorResponse(413, "Document too large to render (2 MB limit).");
  }

  if (!env.BROWSER) {
    return errorResponse(
      503,
      "No Browser Run binding available.",
      "Run via `bun run dev`, which starts Vite with the Cloudflare plugin.",
    );
  }

  // Resolved before the browser starts, so a session is never held open across
  // a session lookup and a database read.
  const preview = await previewTarget(request, body.documentId);

  // The session must outlive this function when a preview follows the PDF, but
  // the response must not. So the PDF is settled through a promise from inside
  // the `withBrowser` callback, and the callback itself — which is what holds
  // the session open — is handed to `waitUntil` rather than awaited.
  // `Promise.withResolvers` in all but name; the project targets ES2022, which
  // predates it.
  let resolve!: (pdf: Uint8Array) => void;
  let reject!: (reason: unknown) => void;
  const pdf = new Promise<Uint8Array>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const session = withBrowser(env.BROWSER, async (browser) => {
    let rendered: Uint8Array;
    try {
      rendered = (await withRenderedPage(browser, html, css, (page) =>
        page.pdf({
          printBackground: true,
          // Page size and margins come entirely from the user's @page CSS.
          preferCSSPageSize: true,
        }),
      )) as Uint8Array;
    } catch (e) {
      reject(e);
      return;
    }
    resolve(rendered);

    // Runs after the PDF is on its way back. A fresh context per render means
    // it cannot see anything the PDF's page left behind.
    //
    // Guarded even though `captureThumbnailWith` already swallows its own
    // failures: past this line the response has been sent, so there is nothing
    // a failure here could usefully do except lose the session its `finally`
    // is about to close.
    if (preview) {
      await captureThumbnailWith(
        browser,
        preview.documentId,
        preview.userId,
        html,
        css,
        preview.revision,
      ).catch((e: unknown) => {
        console.log(`preview alongside render failed for ${preview.documentId}: ${e}`);
      });
    }
  });

  // A session that fails before the callback runs — a launch refused by a rate
  // limit, most likely — leaves `pdf` pending with nothing left to settle it,
  // so the request would hang. Feeding that failure to `reject` is what turns
  // it into a response instead. Harmless once the PDF has resolved, since
  // settling a promise twice does nothing.
  //
  // Note this is `catch`, not `finally`: a *successful* session must not
  // disturb `pdf`, because by then the response has long since been sent and
  // the session is only still open for the thumbnail.
  //
  // The result is also what `waitUntil` is given, rather than `session`
  // itself. Both keep the isolate alive for the capture and the close, but
  // this one has absorbed the failure — handing the runtime a promise that
  // rejects would report an unhandled rejection for something already dealt
  // with here.
  waitUntil(session.catch(reject));

  try {
    return new Response((await pdf) as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const { status, message, hint } = classifyError(e);
    console.log(`render error: ${e}`);
    return errorResponse(status, message, hint);
  }
}

export const Route = createFileRoute("/api/render")({
  server: {
    handlers: {
      POST: ({ request }) => handleRender(request),
      // Without this, a GET falls through to the router and renders the app
      // shell as HTML. Callers expecting JSON should get JSON.
      GET: () => errorResponse(405, "Method not allowed. Use POST."),
    },
  },
});

import { env } from "cloudflare:workers";
import type { Browser } from "@cloudflare/puppeteer";
import { markThumbnail } from "./documents.ts";
import {
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  withBrowser,
  withRenderedPage,
} from "./render.ts";

/**
 * Thumbnail capture.
 *
 * Browser Run is rate-limited and quota-bound, so this is the most likely part
 * of a save to fail — and a missing preview image must never turn a successful
 * save into an error the user sees. Every failure path logs and returns, and
 * the whole capture is bounded by a deadline.
 */

const THUMBNAIL_KEY_PREFIX = "thumbnails/";

/** Stands in for the @page margin, which does not apply to screenshots. */
const PREVIEW_PADDING = "20mm";

export function thumbnailKey(documentId: string): string {
  return `${THUMBNAIL_KEY_PREFIX}${documentId}.webp`;
}

/**
 * Capture and store a preview using a browser session the caller already has.
 *
 * Split out from `captureThumbnail` so the PDF route can render the preview on
 * the session it just used, rather than launching a second one. The session is
 * the expensive thing here — the two renders on it are cheap by comparison —
 * so a preview taken alongside a PDF costs very little more than the PDF did.
 *
 * Swallows every error, for the same reason the standalone entry point does:
 * whatever asked for this has already been answered.
 */
export async function captureThumbnailWith(
  browser: Browser,
  documentId: string,
  userId: string,
  html: string,
  css: string,
  contentRevision: number,
): Promise<void> {
  try {
    // `@page` margins apply to printing, not to screenshots, so a capture
    // would sit flush to the edge where the PDF has a margin. Appended last so
    // it wins over the author's own `body` rule at equal specificity, and
    // scoped to screen so the PDF path is untouched.
    const previewCss = `${css}\n@media screen { body { padding: ${PREVIEW_PADDING}; } }`;

    const image = await withRenderedPage(browser, html, previewCss, async (page) => {
      // A page-shaped viewport so the capture frames the document the way the
      // PDF will, rather than a browser-shaped slice of it.
      await page.setViewport({ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX });
      return await page.screenshot({ type: "webp", quality: 80 });
    });

    // screenshot() hands back a Buffer, which R2 accepts as a stream source.
    await env.THUMBNAILS.put(thumbnailKey(documentId), image, {
      httpMetadata: { contentType: "image/webp" },
    });

    // Conditional: if another save has landed while this was rendering, the
    // image is already stale and marks nothing.
    await markThumbnail(env.DB, documentId, userId, contentRevision);
  } catch (e) {
    // Rate limits and quota exhaustion are expected here, not exceptional.
    // The card falls back to a placeholder until the next save succeeds.
    console.log(`thumbnail capture failed for ${documentId}: ${e}`);
  }
}

/**
 * Screenshot the first page of a document and store it, on a session of its
 * own.
 *
 * Not awaited by the request: callers hand this to `waitUntil` so the save
 * responds immediately and the capture finishes on an extended context. An
 * earlier version raced a 15s deadline inside the request, which was wrong
 * twice over — `Promise.race` stops waiting but cancels nothing, so the work
 * continued unheld on an isolate about to be torn down, and it made the user
 * wait up to 15s for an image that has no bearing on whether their save
 * succeeded.
 *
 * `withRenderedPage` already bounds the slow part with its navigation timeout,
 * so there is nothing left for a deadline here to protect.
 *
 * This is the path for a save with no render beside it — an MCP write, or an
 * editor that has settled without anyone asking for a PDF. When a PDF is being
 * rendered anyway the route calls `captureThumbnailWith` on that session
 * instead, and this second launch never happens.
 */
export async function captureThumbnail(
  documentId: string,
  userId: string,
  html: string,
  css: string,
  contentRevision: number,
): Promise<void> {
  if (!env.BROWSER) return;

  try {
    await withBrowser(env.BROWSER, (browser) =>
      captureThumbnailWith(browser, documentId, userId, html, css, contentRevision),
    );
  } catch (e) {
    // `captureThumbnailWith` handles its own failures, so reaching here means
    // the session could not be launched at all. Same policy: the save is
    // already acknowledged, and a missing preview is never surfaced.
    console.log(`thumbnail session failed for ${documentId}: ${e}`);
  }
}

import { env } from "cloudflare:workers";
import { markThumbnail } from "./documents.ts";
import {
  acquireBrowser,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
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
 * Screenshot the first page of a document and store it.
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
 * Swallows every error: the save has already been acknowledged, and a missing
 * preview must never surface as a failure.
 */
export async function captureThumbnail(
  documentId: string,
  userId: string,
  html: string,
  css: string,
  contentRevision: number,
): Promise<void> {
  if (!env.BROWSER) return;

  let browser: Awaited<ReturnType<typeof acquireBrowser>> | undefined;
  try {
    browser = await acquireBrowser(env.BROWSER);

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
  } finally {
    // Now genuinely scoped to the browser this call acquired: the previous
    // version could reach here with `browser` still undefined while a launch
    // was in flight, orphaning the session it was about to receive.
    browser?.disconnect();
  }
}

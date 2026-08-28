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

/** Longest a save will wait for its preview before giving up on it. */
const CAPTURE_TIMEOUT_MS = 15_000;

/** Stands in for the @page margin, which does not apply to screenshots. */
const PREVIEW_PADDING = "20mm";

export function thumbnailKey(documentId: string): string {
  return `${THUMBNAIL_KEY_PREFIX}${documentId}.webp`;
}

/**
 * Screenshot the first page of a document and store it.
 *
 * Awaited by the caller rather than left running after the response: a Worker
 * isolate may be torn down as soon as it responds, and a bare fire-and-forget
 * promise is simply discarded — which is exactly what happened, silently, when
 * this was first written. `ctx.waitUntil` would be the alternative, but
 * TanStack Start does not expose the execution context to route handlers.
 *
 * Swallows every error and bounds its own runtime, so the save it belongs to
 * can neither fail nor hang because a preview image could not be produced.
 */
export async function captureThumbnail(
  documentId: string,
  userId: string,
  html: string,
  css: string,
): Promise<void> {
  if (!env.BROWSER) return;

  let browser: Awaited<ReturnType<typeof acquireBrowser>> | undefined;
  try {
    // A cold browser launch is ~40s, well past what a save should wait for.
    // Losing this race costs a placeholder, not a failed save.
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("thumbnail capture timed out")),
        CAPTURE_TIMEOUT_MS,
      ),
    );

    await Promise.race([
      (async () => {
        browser = await acquireBrowser(env.BROWSER);

        // `@page` margins apply to printing, not to screenshots, so a capture
        // would sit flush to the edge where the PDF has a margin. Appended
        // last so it wins over the author's own `body` rule at equal
        // specificity, and scoped to screen so the PDF path is untouched.
        const previewCss = `${css}\n@media screen { body { padding: ${PREVIEW_PADDING}; } }`;

        const image = await withRenderedPage(browser, html, previewCss, async (page) => {
          // A page-shaped viewport so the capture frames the document the way
          // the PDF will, rather than a browser-shaped slice of it.
          await page.setViewport({ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX });
          return await page.screenshot({ type: "webp", quality: 80 });
        });

        // screenshot() hands back a Buffer, which R2 accepts as a stream source.
        await env.THUMBNAILS.put(thumbnailKey(documentId), image, {
          httpMetadata: { contentType: "image/webp" },
        });
        await markThumbnail(env.DB, documentId, userId);
      })(),
      deadline,
    ]);
  } catch (e) {
    // Rate limits and quota exhaustion are expected here, not exceptional.
    // The card falls back to a placeholder until the next save succeeds.
    console.log(`thumbnail capture failed for ${documentId}: ${e}`);
  } finally {
    browser?.disconnect();
  }
}

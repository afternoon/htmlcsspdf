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
 * Runs after a save has already been acknowledged, never as part of it. Browser
 * Run is rate-limited and quota-bound, so capture is the most likely thing here
 * to fail — and a failed preview image must never turn a successful save into
 * an error the user sees. Every failure path below logs and returns.
 */

const THUMBNAIL_KEY_PREFIX = "thumbnails/";

export function thumbnailKey(documentId: string): string {
  return `${THUMBNAIL_KEY_PREFIX}${documentId}.webp`;
}

/**
 * Screenshot the first page of a document and store it.
 *
 * Deliberately swallows every error: the caller has already responded.
 */
export async function captureThumbnail(
  documentId: string,
  userId: string,
  html: string,
  css: string,
): Promise<void> {
  if (!env.BROWSER || !env.THUMBNAILS) return;

  let browser: Awaited<ReturnType<typeof acquireBrowser>> | undefined;
  try {
    browser = await acquireBrowser(env.BROWSER);
    const image = await withRenderedPage(browser, html, css, async (page) => {
      // A page-shaped viewport so the capture frames the document the way the
      // PDF will, rather than a browser-shaped slice of it.
      await page.setViewport({ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX });
      return await page.screenshot({ type: "webp", quality: 80 });
    });

    // screenshot() hands back a Buffer, which R2 accepts as a stream source.
    await env.THUMBNAILS.put(thumbnailKey(documentId), image, {
      httpMetadata: { contentType: "image/webp" },
    });
    await markThumbnail(env.DB, documentId, userId);
  } catch (e) {
    // Rate limits and quota exhaustion are expected here, not exceptional.
    // The card falls back to a placeholder until the next save succeeds.
    console.log(`thumbnail capture failed for ${documentId}: ${e}`);
  } finally {
    browser?.disconnect();
  }
}

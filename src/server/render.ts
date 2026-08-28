import type { ActiveSession, Browser, BrowserWorker, Page } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import { sanitizeHtml } from "../sanitize.ts";

/**
 * Browser Run access: acquiring a session, and running one page in isolation.
 *
 * Shared by the PDF route and thumbnail capture so both get the same isolation
 * and the same session reuse — a second copy of this would be a second place
 * for the isolation rules to drift.
 */

/** Keep the browser warm between renders so a 1s debounce doesn't hit the
 *  free plan's "1 new instance per 20s" limit. Max allowed is 10 minutes. */
const KEEP_ALIVE_MS = 600_000;
export const NAV_TIMEOUT_MS = 20_000;

/** A4 at 96dpi. Only used to give screenshots a page-shaped viewport. */
export const PAGE_WIDTH_PX = 794;
export const PAGE_HEIGHT_PX = 1123;

/** Pick an existing session nobody is connected to. */
async function getFreeSession(endpoint: BrowserWorker): Promise<string | undefined> {
  try {
    const sessions: ActiveSession[] = await puppeteer.sessions(endpoint);
    const free = sessions.filter((s) => !s.connectionId).map((s) => s.sessionId);
    if (free.length === 0) return undefined;
    return free[Math.floor(Math.random() * free.length)];
  } catch (e) {
    console.log(`sessions() failed: ${e}`);
    return undefined;
  }
}

export async function acquireBrowser(endpoint: BrowserWorker): Promise<Browser> {
  const sessionId = await getFreeSession(endpoint);
  if (sessionId) {
    try {
      return await puppeteer.connect(endpoint, sessionId);
    } catch (e) {
      // Session died between listing and connecting; fall through to launch.
      console.log(`connect(${sessionId}) failed: ${e}`);
    }
  }
  return await puppeteer.launch(endpoint, { keep_alive: KEEP_ALIVE_MS });
}

export function buildDocument(html: string, css: string): string {
  // Sanitised here as well as on save, because this route also renders
  // unsaved content straight from the editor. The server never trusts the
  // client's own check.
  const safeHtml = sanitizeHtml(html);
  // The user's HTML may or may not be a full document. If it already has a
  // <head>, inject the stylesheet there; otherwise wrap it in a minimal shell.
  const style = `<style>\n${css}\n</style>`;
  if (/<head[\s>]/i.test(safeHtml)) {
    return safeHtml.replace(/(<head[^>]*>)/i, `$1\n${style}\n`);
  }
  if (/<html[\s>]/i.test(safeHtml)) {
    return safeHtml.replace(/(<html[^>]*>)/i, `$1\n<head>\n${style}\n</head>\n`);
  }
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${style}
</head>
<body>
${safeHtml}
</body>
</html>`;
}

/**
 * Load a document into an isolated page and hand it to `use`.
 *
 * Two isolation properties matter here, and neither is optional:
 *
 * 1. A fresh browser *context* per render. Cookies, localStorage, cache and
 *    service workers are context-scoped, not page-scoped, so `page.close()`
 *    alone leaves them behind — and sessions are reused across users by
 *    design, to stay under the rate limit. Without this, one user's document
 *    could plant a cookie or poison the cache for another's.
 *
 * 2. JavaScript disabled. `setContent` is implemented as `document.write`, so
 *    inline script in the source would otherwise execute. The sanitiser
 *    already removes it; this makes a sanitiser bypass inert rather than
 *    exploitable. It must be set before `setContent`, since the flag only
 *    takes effect from the next navigation.
 */
export async function withRenderedPage<T>(
  browser: Browser,
  html: string,
  css: string,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(buildDocument(html, css), {
      waitUntil: "networkidle0",
      timeout: NAV_TIMEOUT_MS,
    });
    return await use(page);
  } finally {
    // Closes the context's pages with it, discarding cookies, storage and
    // cache. The browser itself stays warm for the next render.
    await context.close().catch(() => {});
  }
}

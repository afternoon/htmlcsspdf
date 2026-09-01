import type { Browser, BrowserWorker, Page } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import { sanitizeCss, sanitizeHtml } from "../sanitize.ts";

/**
 * Browser Run access: acquiring a session, and running one page in isolation.
 *
 * Shared by the PDF route and thumbnail capture so both get the same isolation
 * and the same lifecycle — a second copy of this would be a second place for
 * the rules to drift.
 */

/**
 * How long a session may idle before Browser Run reclaims it.
 *
 * Sessions used to be kept warm for the full ten minutes and handed back with
 * `disconnect()`, on the theory that reuse would keep a 1s debounce under the
 * free plan's "one new instance per 20s" limit. That trade is wrong for this
 * tool: usage is a handful of bursty requests, so a warm session spends
 * browser-minutes idling far more often than it saves a launch. Sessions are
 * now closed as soon as the work that needed one is done, and this is only a
 * backstop for a session orphaned by an isolate that died mid-render.
 */
const KEEP_ALIVE_MS = 60_000;
export const NAV_TIMEOUT_MS = 20_000;

/** A4 at 96dpi. Only used to give screenshots a page-shaped viewport. */
export const PAGE_WIDTH_PX = 794;
export const PAGE_HEIGHT_PX = 1123;

/**
 * Run `use` against a browser session, and close the session afterwards.
 *
 * Closing rather than disconnecting is the point. Browser Run bills for the
 * time a session exists, not for the time something is attached to it, so a
 * disconnected-but-live session keeps spending the quota that the next PDF
 * depends on. Every caller therefore gets the session for exactly the span of
 * its own work.
 *
 * That makes the *shape* of a caller matter: everything a request needs from
 * the browser has to happen inside one `use`, because there is no warm session
 * waiting for a second call. `withBrowser` is what lets the PDF route capture
 * a thumbnail on the session it already has.
 */
export async function withBrowser<T>(
  endpoint: BrowserWorker,
  use: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await puppeteer.launch(endpoint, { keep_alive: KEEP_ALIVE_MS });
  try {
    return await use(browser);
  } finally {
    // close(), not disconnect(): ends the session and stops the meter. Failing
    // to close is not worth surfacing over the caller's own result — but it
    // does mean a session is left to idle out, so it is logged.
    await browser.close().catch((e: unknown) => {
      console.log(`browser close failed: ${e}`);
    });
  }
}

export function buildDocument(html: string, css: string): string {
  // Sanitised here as well as on save, because this route also renders
  // unsaved content straight from the editor. The server never trusts the
  // client's own check.
  const safeHtml = sanitizeHtml(html);
  // CSS is sanitised too, and for a sharper reason than the HTML: it is
  // interpolated into a <style> element, so a `</style>` in it would end that
  // element and hand everything after it to the HTML parser — bypassing the
  // allowlist entirely.
  const style = `<style>\n${sanitizeCss(css)}\n</style>`;
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
 *    alone leaves them behind. A session no longer outlives the request that
 *    launched it, but it still serves more than one render within it — the
 *    PDF and then the preview image — and each must start from nothing, so
 *    that a document cannot plant state that the next render reads back.
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
    // cache. The browser stays up for the rest of this request's work;
    // `withBrowser` is what ends the session.
    await context.close().catch(() => {});
  }
}

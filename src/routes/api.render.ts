import { env } from "cloudflare:workers";
import type { ActiveSession, Browser, BrowserWorker } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import { createFileRoute } from "@tanstack/react-router";

interface RenderBody {
  html?: unknown;
  css?: unknown;
}

/** Keep the browser warm between renders so a 1s debounce doesn't hit the
 *  free plan's "1 new instance per 20s" limit. Max allowed is 10 minutes. */
const KEEP_ALIVE_MS = 600_000;
const MAX_INPUT_BYTES = 2_000_000;
const NAV_TIMEOUT_MS = 20_000;

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

async function acquireBrowser(endpoint: BrowserWorker): Promise<Browser> {
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

function buildDocument(html: string, css: string): string {
  // The user's HTML may or may not be a full document. If it already has a
  // <head>, inject the stylesheet there; otherwise wrap it in a minimal shell.
  const style = `<style>\n${css}\n</style>`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n${style}\n`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1\n<head>\n${style}\n</head>\n`);
  }
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${style}
</head>
<body>
${html}
</body>
</html>`;
}

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

  let browser: Browser | undefined;
  try {
    browser = await acquireBrowser(env.BROWSER);
    const page = await browser.newPage();
    try {
      await page.setContent(buildDocument(html, css), {
        waitUntil: "networkidle0",
        timeout: NAV_TIMEOUT_MS,
      });
      const pdf = await page.pdf({
        printBackground: true,
        // Page size and margins come entirely from the user's @page CSS.
        preferCSSPageSize: true,
      });
      return new Response(pdf as BodyInit, {
        headers: {
          "content-type": "application/pdf",
          "cache-control": "no-store",
        },
      });
    } finally {
      // Close the page but leave the browser warm for the next render.
      await page.close().catch(() => {});
    }
  } catch (e) {
    const { status, message, hint } = classifyError(e);
    console.log(`render error: ${e}`);
    return errorResponse(status, message, hint);
  } finally {
    // disconnect(), not close() — keeps the session alive for reuse.
    browser?.disconnect();
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

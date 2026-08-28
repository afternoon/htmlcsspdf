import { env } from "cloudflare:workers";
import type { Browser } from "@cloudflare/puppeteer";
import { createFileRoute } from "@tanstack/react-router";
import { acquireBrowser, withRenderedPage } from "../server/render.ts";

interface RenderBody {
  html?: unknown;
  css?: unknown;
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
 * Renders to PDF. Deliberately open to unauthenticated callers: previewing
 * before signing in is the point, and the Browser Run quota is a hard ceiling
 * rather than a runaway cost.
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

  let browser: Browser | undefined;
  try {
    browser = await acquireBrowser(env.BROWSER);
    const pdf = await withRenderedPage(browser, html, css, (page) =>
      page.pdf({
        printBackground: true,
        // Page size and margins come entirely from the user's @page CSS.
        preferCSSPageSize: true,
      }),
    );
    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
      },
    });
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, capturePreview, saveDocument } from "./documentsApi.ts";

/**
 * The client half of the document API.
 *
 * What is worth testing here is the shape of what goes out and what comes
 * back, rather than the transport: a save that quietly drops its options, or a
 * body-less response parsed as JSON, both fail as a request that "succeeded".
 */

function mockFetch(response: Response) {
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** What the worker sends back when it has accepted work but has no body. */
function accepted(status: number) {
  return new Response(null, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving content", () => {
  it("asks for a preview by default", async () => {
    const fetch = mockFetch(accepted(204));

    await saveDocument("doc-1", "<h1>Hi</h1>", "h1 {}");

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      html: "<h1>Hi</h1>",
      css: "h1 {}",
      capturePreview: true,
    });
  });

  it("carries a request for a quiet write", async () => {
    // Auto-save's whole reason for existing as a separate call: a browser
    // render per pause in typing would spend the quota the PDF depends on.
    const fetch = mockFetch(accepted(204));

    await saveDocument("doc-1", "<h1>Hi</h1>", "h1 {}", { capturePreview: false });

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ capturePreview: false });
  });

  it("surfaces the server's message on failure", async () => {
    mockFetch(
      new Response(JSON.stringify({ error: "Document not found." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(saveDocument("doc-1", "", "")).rejects.toThrow(ApiError);
  });
});

describe("asking for a preview", () => {
  it("posts to the document's thumbnail", async () => {
    const fetch = mockFetch(accepted(202));

    await capturePreview("doc-1");

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/documents/doc-1/thumbnail");
    expect(init.method).toBe("POST");
  });

  it("accepts an answer with no body at all", async () => {
    // The capture is queued past the response, so there is nothing to return —
    // and parsing that emptiness as JSON would report a working call as broken.
    mockFetch(accepted(202));

    await expect(capturePreview("doc-1")).resolves.toBeUndefined();
  });
});

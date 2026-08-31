import { describe, expect, it, vi } from "vitest";
import { MAX_CONTENT_BYTES } from "./documentsApi.ts";
import { type DroppedFile, planDrop, readDrop } from "./dropFiles.ts";

/**
 * A stand-in for a dropped file.
 *
 * The rules are about names, types, sizes and counts, so the bytes are held as
 * a string and `text()` is a plain promise — nothing here needs a real Blob.
 */
function file(
  name: string,
  type: string,
  content = "",
  size = content.length,
): DroppedFile {
  return { name, type, size, text: async () => content };
}

describe("planning a drop", () => {
  it("rejects a drop carrying no files", () => {
    expect(planDrop([])).toEqual({
      ok: false,
      error: expect.stringContaining("Drop an"),
    });
  });

  it("rejects more than two files", () => {
    const result = planDrop([
      file("a.html", "text/html"),
      file("b.css", "text/css"),
      file("c.css", "text/css"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain("at most 2 files");
  });

  it("rejects two files of the same kind", () => {
    const result = planDrop([file("a.html", "text/html"), file("b.html", "text/html")]);

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain("not two HTML files");
  });

  it("names the file it does not recognise", () => {
    const result = planDrop([file("report.pdf", "application/pdf")]);

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain("report.pdf");
  });

  it("rejects a file larger than a document may be", () => {
    const result = planDrop([
      file("huge.html", "text/html", "<p>x</p>", MAX_CONTENT_BYTES + 1),
    ]);

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain("too large");
  });

  it("recognises HTML and CSS by their reported type", () => {
    const result = planDrop([file("page.html", "text/html"), file("s.css", "text/css")]);

    expect(result.ok && result.files.map((entry) => entry.kind)).toEqual(["html", "css"]);
  });

  it("ignores charset parameters on the type", () => {
    const result = planDrop([file("page.html", "text/html;charset=utf-8")]);

    expect(result.ok && result.files[0].kind).toBe("html");
  });

  // Some platforms report no type at all for a dragged file, which is not the
  // same as reporting one we do not accept.
  it("falls back to the extension when no type is reported", () => {
    const result = planDrop([file("page.HTM", ""), file("theme.css", "")]);

    expect(result.ok && result.files.map((entry) => entry.kind)).toEqual(["html", "css"]);
  });

  it("rejects an unknown extension when no type is reported", () => {
    const result = planDrop([file("notes.txt", "")]);

    expect(result.ok).toBe(false);
  });

  it("does not guess from the extension when the type is one we refuse", () => {
    const result = planDrop([file("page.html", "application/pdf")]);

    expect(result.ok).toBe(false);
  });
});

describe("reading a drop", () => {
  it("fills the HTML pane from an HTML file", async () => {
    const result = await readDrop([file("page.html", "text/html", "<p>hello</p>")]);

    expect(result).toEqual({
      ok: true,
      content: { html: "<p>hello</p>", name: "page" },
    });
  });

  it("fills the CSS pane from a stylesheet", async () => {
    const result = await readDrop([file("theme.css", "text/css", "p { color: red }")]);

    expect(result.ok && result.content).toEqual({
      css: "p { color: red }",
      name: "theme",
    });
  });

  it("fills both panes from one file of each kind", async () => {
    const result = await readDrop([
      file("theme.css", "text/css", "p{}"),
      file("page.html", "text/html", "<p></p>"),
    ]);

    expect(result.ok && result.content.html).toBe("<p></p>");
    expect(result.ok && result.content.css).toBe("p{}");
  });

  it("names the document after the HTML file when both are dropped", async () => {
    const result = await readDrop([
      file("theme.css", "text/css", "p{}"),
      file("invoice.html", "text/html", "<p></p>"),
    ]);

    expect(result.ok && result.content.name).toBe("invoice");
  });

  it("falls back to Untitled when the name is left empty by stripping", async () => {
    const result = await readDrop([file(".html", "text/html", "<p></p>")]);

    expect(result.ok && result.content.name).toBe("Untitled");
  });

  it("reports a file whose contents cannot be read", async () => {
    const unreadable: DroppedFile = {
      name: "page.html",
      type: "text/html",
      size: 10,
      text: () => Promise.reject(new Error("gone")),
    };

    const result = await readDrop([unreadable]);

    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain("Could not read");
  });

  it("reads nothing when the drop is rejected", async () => {
    const text = vi.fn(async () => "");
    await readDrop([
      { name: "a.html", type: "text/html", size: 1, text },
      { name: "b.html", type: "text/html", size: 1, text },
    ]);

    expect(text).not.toHaveBeenCalled();
  });
});

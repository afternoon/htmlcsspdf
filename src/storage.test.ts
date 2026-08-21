import { beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_CSS, SAMPLE_HTML } from "./sample.ts";
import {
  clampFraction,
  DEFAULT_LAYOUT,
  loadDoc,
  loadLayout,
  MAX_FRACTION,
  MIN_FRACTION,
  saveDoc,
  saveLayout,
} from "./storage.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("clampFraction", () => {
  it("keeps a fraction inside the panes' bounds", () => {
    expect(clampFraction(0.5)).toBe(0.5);
  });

  it("stops a pane being dragged shut", () => {
    expect(clampFraction(0)).toBe(MIN_FRACTION);
    expect(clampFraction(-3)).toBe(MIN_FRACTION);
  });

  it("stops a pane swallowing the window", () => {
    expect(clampFraction(1)).toBe(MAX_FRACTION);
  });

  it("falls back to the default for a value that is not a number", () => {
    expect(clampFraction(Number.NaN)).toBe(DEFAULT_LAYOUT.editors);
  });
});

describe("loadDoc", () => {
  it("returns the sample document on a first visit", () => {
    expect(loadDoc()).toEqual({ html: SAMPLE_HTML, css: SAMPLE_CSS });
  });

  it("restores a saved document", () => {
    saveDoc({ html: "<p>saved</p>", css: "body { margin: 0; }" });
    expect(loadDoc()).toEqual({ html: "<p>saved</p>", css: "body { margin: 0; }" });
  });

  it("migrates a document saved under the pre-rename key", () => {
    localStorage.setItem(
      "pdfpen.doc.v1",
      JSON.stringify({ html: "<p>legacy</p>", css: "body { margin: 1pt; }" }),
    );

    expect(loadDoc()).toEqual({
      html: "<p>legacy</p>",
      css: "body { margin: 1pt; }",
    });
    // The old key is retired so the migration runs only once.
    expect(localStorage.getItem("pdfpen.doc.v1")).toBeNull();
    expect(localStorage.getItem("htmlcsspdf.doc.v1")).not.toBeNull();
  });

  it("prefers a current document over a stale legacy one", () => {
    localStorage.setItem("pdfpen.doc.v1", JSON.stringify({ html: "<p>old</p>" }));
    saveDoc({ html: "<p>new</p>", css: "body {}" });

    expect(loadDoc().html).toBe("<p>new</p>");
  });

  it("falls back to the sample when stored data is corrupt", () => {
    localStorage.setItem("htmlcsspdf.doc.v1", "not json");
    expect(loadDoc()).toEqual({ html: SAMPLE_HTML, css: SAMPLE_CSS });
  });

  it("fills in a missing half of the document", () => {
    localStorage.setItem("htmlcsspdf.doc.v1", JSON.stringify({ html: "<p>only</p>" }));
    expect(loadDoc()).toEqual({ html: "<p>only</p>", css: SAMPLE_CSS });
  });
});

describe("loadLayout", () => {
  it("returns the default split on a first visit", () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("restores a saved split", () => {
    saveLayout({ editors: 0.3, htmlRows: 0.4 });
    expect(loadLayout()).toEqual({ editors: 0.3, htmlRows: 0.4 });
  });

  it("clamps an out-of-range stored split rather than collapsing a pane", () => {
    localStorage.setItem(
      "htmlcsspdf.layout.v1",
      JSON.stringify({ editors: 0.99, htmlRows: -1 }),
    );
    expect(loadLayout()).toEqual({ editors: MAX_FRACTION, htmlRows: MIN_FRACTION });
  });

  it("falls back to the default when stored data is corrupt", () => {
    localStorage.setItem("htmlcsspdf.layout.v1", "{{{");
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});

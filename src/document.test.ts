import { describe, expect, it } from "vitest";
import {
  describeIssue,
  formatCss,
  formatHtml,
  validate,
  validateCss,
  validateHtml,
} from "./document.ts";

describe("validateCss", () => {
  it("accepts a stylesheet that parses", async () => {
    expect(await validateCss("body { color: red; }")).toEqual([]);
  });

  it("accepts an empty stylesheet", async () => {
    expect(await validateCss("   ")).toEqual([]);
  });

  it("reports an unclosed block", async () => {
    const issues = await validateCss("body { color: red;");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].source).toBe("css");
  });

  it("reports the line of an unclosed block", async () => {
    const issues = await validateCss("body { color: red; }\n\np { color:");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].line).toBe(3);
  });

  it("accepts @page rules, which htmlcsspdf relies on", async () => {
    expect(await validateCss("@page { size: A4; margin: 20mm; }")).toEqual([]);
  });
});

describe("validateHtml", () => {
  it("accepts well-formed markup", () => {
    expect(validateHtml("<p>hello</p>")).toEqual([]);
  });

  it("accepts a fragment with no wrapper element", () => {
    expect(validateHtml("just text")).toEqual([]);
  });

  it("tolerates unclosed tags the parser can infer", () => {
    // HTML parsing is lenient by design; this renders fine, so it must not
    // block a preview.
    expect(validateHtml("<div><p>unclosed</div>")).toEqual([]);
  });

  it("reports an unterminated tag", () => {
    const issues = validateHtml("<div");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].source).toBe("html");
  });
});

describe("validate", () => {
  it("passes when both sources are valid", async () => {
    const result = await validate("<p>hi</p>", "body { margin: 0; }");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails and reports the offending source when CSS is broken", async () => {
    const result = await validate("<p>hi</p>", "body { color: ");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.source === "css")).toBe(true);
  });

  it("passes for the empty document", async () => {
    expect((await validate("", "")).ok).toBe(true);
  });

  it("passes for the bundled resume example", async () => {
    // Regression guard: these files are shipped in examples/ and must render.
    const html = '<header class="masthead"><h1>Ben Godfrey</h1></header>';
    const css = "@page { size: A4; margin: 18mm 16mm; }\n:root { --ink: #1a1a1a; }";
    expect((await validate(html, css)).ok).toBe(true);
  });
});

describe("formatCss", () => {
  it("normalises spacing and indentation", async () => {
    const result = await formatCss("body{color:red;margin:0}");
    expect(result.text).toBe("body {\n  color: red;\n  margin: 0;\n}\n");
    expect(result.changed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("reports no change for already-formatted input", async () => {
    const once = await formatCss("body{color:red}");
    const twice = await formatCss(once.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  it("returns the original text and an error when CSS cannot be parsed", async () => {
    const input = "body { color: ";
    const result = await formatCss(input);
    expect(result.text).toBe(input);
    expect(result.changed).toBe(false);
    expect(result.error?.source).toBe("css");
  });

  it("leaves empty input alone", async () => {
    const result = await formatCss("");
    expect(result.text).toBe("");
    expect(result.changed).toBe(false);
  });
});

describe("formatHtml", () => {
  it("indents nested elements", async () => {
    const result = await formatHtml("<div><p>hi</p><span>there</span></div>");
    expect(result.text).toContain("\n");
    expect(result.error).toBeUndefined();
  });

  it("returns the original text and an error when HTML cannot be parsed", async () => {
    const input = "<div";
    const result = await formatHtml(input);
    expect(result.text).toBe(input);
    expect(result.error?.source).toBe("html");
  });
});

describe("describeIssue", () => {
  it("includes the line number when the parser reported one", () => {
    expect(describeIssue({ source: "css", message: "Unclosed block", line: 4 })).toBe(
      "CSS: Unclosed block (line 4)",
    );
  });

  it("does not repeat a position already in the parser message", async () => {
    const issues = await validateCss("body { color: red;");
    // postcss says "Unclosed block (1:1)"; describeIssue adds "(line 1)".
    expect(describeIssue(issues[0])).not.toMatch(/\(\d+:\d+\)/);
  });

  it("omits the position when none is known", () => {
    expect(describeIssue({ source: "html", message: "Could not parse HTML." })).toBe(
      "HTML: Could not parse HTML.",
    );
  });
});

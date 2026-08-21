import { parseFragment } from "parse5";

/**
 * Prettier and its parsers are ~550kB of the bundle, and neither is needed
 * until the first render or Format press. Loading them on demand keeps them
 * out of the startup path; the module cache makes later calls free.
 */
async function loadPrettier() {
  const [prettier, htmlPlugin, cssPlugin] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/html"),
    import("prettier/plugins/postcss"),
  ]);
  return { prettier, htmlPlugin: htmlPlugin.default, cssPlugin: cssPlugin.default };
}

/**
 * Validation and formatting for the editor's HTML and CSS.
 *
 * Plain module: no framework imports, so it can be tested without rendering.
 */

export type Source = "html" | "css";

export interface Issue {
  source: Source;
  message: string;
  /** 1-based, when the parser reports a position. */
  line?: number;
  column?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
}

/** Errors that mean "this cannot be parsed", as opposed to lenient recovery. */
const FATAL_HTML_CODES = new Set([
  "eof-in-tag",
  "eof-in-script-html-comment-like-text",
  "eof-in-comment",
  "eof-in-cdata",
  "unexpected-null-character",
  "missing-end-tag-name",
  "invalid-first-character-of-tag-name",
]);

function positionFromPrettierError(e: unknown): { line?: number; column?: number } {
  if (typeof e !== "object" || e === null) return {};
  const loc = (e as { loc?: { start?: { line?: number; column?: number } } }).loc;
  const start = loc?.start;
  if (!start) return {};
  return { line: start.line, column: start.column };
}

function cleanMessage(raw: string): string {
  // Prettier prefixes the underlying parser name, appends a code frame, and
  // embeds a "(line:col)" suffix that describeIssue would print again.
  return raw
    .split("\n")[0]
    .replace(/^CssSyntaxError:\s*/, "")
    .replace(/^SyntaxError:\s*/, "")
    .replace(/\s*\(\d+:\d+\)\s*$/, "")
    .trim();
}

/**
 * HTML parsers recover from almost anything, so this reports only the errors
 * that indicate genuinely malformed markup — an unterminated tag, say — and
 * stays quiet about unclosed elements the parser can legally infer.
 */
export function validateHtml(html: string): Issue[] {
  if (!html.trim()) return [];

  const issues: Issue[] = [];
  try {
    parseFragment(html, {
      sourceCodeLocationInfo: true,
      onParseError: (err) => {
        if (!FATAL_HTML_CODES.has(err.code)) return;
        issues.push({
          source: "html",
          message: err.code.replace(/-/g, " "),
          line: err.startLine,
          column: err.startCol,
        });
      },
    });
  } catch (e) {
    issues.push({
      source: "html",
      message: e instanceof Error ? cleanMessage(e.message) : "Could not parse HTML.",
    });
  }
  return issues;
}

/**
 * Validates CSS by parsing it with Prettier's postcss parser.
 *
 * css-tree was the obvious choice here but it implements the CSS spec's error
 * recovery, which silently auto-closes an unclosed block at EOF — so
 * `body { color:` parses clean. postcss rejects it, which is what an author
 * editing a stylesheet actually wants to hear about.
 */
export async function validateCss(css: string): Promise<Issue[]> {
  if (!css.trim()) return [];
  const result = await formatCss(css);
  return result.error ? [result.error] : [];
}

export async function validate(html: string, css: string): Promise<ValidationResult> {
  const issues = [...validateHtml(html), ...(await validateCss(css))];
  return { ok: issues.length === 0, issues };
}

export interface FormatResult {
  /** Formatted text, or the original when it could not be parsed. */
  text: string;
  changed: boolean;
  /** Set when formatting failed; the text is returned untouched. */
  error?: Issue;
}

async function formatWith(
  text: string,
  source: Source,
  parser: "html" | "css",
): Promise<FormatResult> {
  if (!text.trim()) return { text, changed: false };
  try {
    const { prettier, htmlPlugin, cssPlugin } = await loadPrettier();
    const formatted = await prettier.format(text, {
      parser,
      plugins: [parser === "html" ? htmlPlugin : cssPlugin],
      printWidth: 100,
      tabWidth: 2,
    });
    return { text: formatted, changed: formatted !== text };
  } catch (e) {
    return {
      text,
      changed: false,
      error: {
        source,
        message: e instanceof Error ? cleanMessage(e.message) : "Could not format.",
        ...positionFromPrettierError(e),
      },
    };
  }
}

export function formatHtml(html: string): Promise<FormatResult> {
  return formatWith(html, "html", "html");
}

export function formatCss(css: string): Promise<FormatResult> {
  return formatWith(css, "css", "css");
}

/** Human-readable one-liner for an issue, including position when known. */
export function describeIssue(issue: Issue): string {
  const where = issue.line ? ` (line ${issue.line})` : "";
  return `${issue.source.toUpperCase()}: ${issue.message}${where}`;
}

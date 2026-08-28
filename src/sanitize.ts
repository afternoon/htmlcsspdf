import { type DefaultTreeAdapterMap, parse, parseFragment, serialize } from "parse5";
import type { Issue } from "./document.ts";

/**
 * Allowlist sanitiser for document HTML.
 *
 * This is a security boundary, not a convenience: its output is rendered by a
 * real browser on our infrastructure and served back to users. Everything not
 * named here is removed.
 *
 * The rule is *no code execution*, not *no network access*. Documents may
 * reference images and fonts from anywhere: the rendering browser carries no
 * credentials and runs in a per-render incognito context, so an outbound fetch
 * discloses nothing the author does not already possess. What must never
 * survive is anything that can run script.
 *
 * Plain module: no framework imports, so it runs identically in the editor and
 * in the Worker. The editor's copy is advisory; the server's is the boundary.
 */

type Node = DefaultTreeAdapterMap["node"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type Element = DefaultTreeAdapterMap["element"];

const HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Elements permitted in a document. Semantic content only: things that carry
 * meaning in print. Anything that loads or runs code is absent by design.
 */
const ALLOWED_ELEMENTS = new Set([
  // Document scaffolding.
  "html",
  "head",
  "body",
  "title",
  "style",
  // Sections and headings.
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "footer",
  "main",
  "section",
  "article",
  "aside",
  "nav",
  "div",
  "p",
  "br",
  "hr",
  "span",
  // Lists.
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // Tables.
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  // Inline semantics.
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "small",
  "mark",
  "abbr",
  "cite",
  "q",
  "code",
  "kbd",
  "samp",
  "var",
  "sub",
  "sup",
  "time",
  "data",
  "wbr",
  // Blocks.
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "address",
  // Edits.
  "ins",
  "del",
  // Media.
  "img",
]);

/**
 * Attributes permitted on any element. `style` is absent deliberately: authors
 * have a dedicated CSS pane, and inline style is a recurring injection surface.
 */
const GLOBAL_ATTRIBUTES = new Set(["class", "id", "title", "lang", "dir"]);

/** Attributes permitted on specific elements only. */
const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  td: new Set(["colspan", "rowspan", "headers"]),
  th: new Set(["colspan", "rowspan", "headers", "scope", "abbr"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "reversed", "type"]),
  li: new Set(["value"]),
  time: new Set(["datetime"]),
  data: new Set(["value"]),
  ins: new Set(["datetime"]),
  del: new Set(["datetime"]),
  q: new Set(["cite"]),
  blockquote: new Set(["cite"]),
  abbr: new Set(["title"]),
};

/** Attributes holding a URL, which need their scheme checked. */
const URL_ATTRIBUTES = new Set(["href", "src", "cite"]);

/**
 * Schemes permitted in a URL attribute. Any host is allowed — the restriction
 * is on the scheme, because `javascript:` and `vbscript:` are code execution
 * while `https:` is merely a fetch.
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "data:"]);

/**
 * `data:` payloads are restricted to raster image types, named individually.
 *
 * A `data:image/` prefix test would be too loose: `image/svg+xml` matches it,
 * and SVG is a document format that can carry script and its own event
 * handlers. Navigating to such a URL executes it. Raster formats cannot.
 */
const ALLOWED_DATA_PREFIXES = [
  "data:image/png",
  "data:image/jpeg",
  "data:image/jpg",
  "data:image/gif",
  "data:image/webp",
  "data:image/avif",
  "data:image/bmp",
];

/**
 * True if a URL attribute value is safe to keep.
 *
 * Parsing beats pattern-matching here: parse5 has already decoded entities, so
 * `&#106;avascript:` arrives as `javascript:`. Control characters and leading
 * whitespace are stripped first because browsers ignore them when resolving a
 * scheme, which is the basis of the classic `java\tscript:` bypass.
 */
function isSafeUrl(value: string): boolean {
  // Browsers strip ASCII whitespace and control characters before resolving a
  // scheme, so `java&#9;script:` executes. Strip the same set here, or such a
  // value reads as a scheme-less relative URL and survives untouched.
  //
  // U+FFFD is included because parse5 substitutes it for a NUL byte. Browsers
  // do not strip U+FFFD, so `java\ufffdscript:` cannot actually execute, but
  // treating it as a separator keeps the check conservative either way.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching what the URL parser itself ignores
  const cleaned = value.replace(/[\u0000-\u0020\u007f\ufffd]/g, "").toLowerCase();
  if (cleaned === "") return true;
  // Relative URLs and fragments carry no scheme and cannot execute.
  if (!/^[a-z][a-z0-9+.-]*:/.test(cleaned)) return true;
  const scheme = cleaned.slice(0, cleaned.indexOf(":") + 1);
  if (!ALLOWED_SCHEMES.has(scheme)) return false;
  if (scheme === "data:") return ALLOWED_DATA_PREFIXES.some((p) => cleaned.startsWith(p));
  return true;
}

function isAllowedAttribute(tagName: string, attrName: string): boolean {
  const name = attrName.toLowerCase();
  // Every `on*` attribute is an event handler. The allowlists below already
  // exclude them, so this is redundant today and no test can distinguish its
  // removal — it is kept as a standing guard for the day someone widens an
  // element's attribute set and does not think about event handlers.
  if (name.startsWith("on")) return false;
  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  return ELEMENT_ATTRIBUTES[tagName]?.has(name) ?? false;
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function hasChildNodes(node: Node): node is ParentNode {
  return "childNodes" in node;
}

/**
 * An element is kept only if it is allowlisted *and* in the HTML namespace.
 *
 * In practice the name check alone does the work, because parse5 only produces
 * foreign-namespace elements underneath a foreign root (`svg`, `math`) that is
 * itself not allowlisted and already dropped with its subtree. The namespace
 * test guards the case where that stops being true — an allowlisted name such
 * as `a` or `title` also exists in SVG, with different parsing and different
 * attributes, and must never be treated as its HTML namesake.
 */
function isAllowedElement(el: Element): boolean {
  return el.namespaceURI === HTML_NS && ALLOWED_ELEMENTS.has(el.tagName.toLowerCase());
}

/** Remove disallowed elements and attributes from a parsed tree, in place. */
function scrub(node: Node): void {
  if (!hasChildNodes(node)) return;

  const kept: Node[] = [];
  for (const child of node.childNodes) {
    if (isElement(child)) {
      if (!isAllowedElement(child)) {
        // Dropped with its subtree. A disallowed element's children are not
        // rescued: `<script>` content is code, and a foreign-namespace subtree
        // is exactly the payload the namespace check exists to remove.
        continue;
      }
      const tagName = child.tagName.toLowerCase();
      child.attrs = child.attrs.filter(
        (attr) =>
          isAllowedAttribute(tagName, attr.name) &&
          (!URL_ATTRIBUTES.has(attr.name.toLowerCase()) || isSafeUrl(attr.value)),
      );
    }
    scrub(child);
    kept.push(child);
  }
  node.childNodes = kept as typeof node.childNodes;
}

/** True if the source looks like a whole document rather than a fragment. */
function isFullDocument(html: string): boolean {
  return /<(!doctype|html|head|body)[\s>]/i.test(html);
}

/**
 * Return `html` with everything outside the allowlist removed.
 *
 * Output is re-serialised from the parsed tree rather than edited as text, so
 * what callers receive is what a browser will actually build. Text is escaped
 * on the way out, which is why an already-escaped `&lt;script&gt;` stays inert
 * instead of being resurrected.
 */
export function sanitizeHtml(html: string): string {
  if (!html.trim()) return html;

  if (isFullDocument(html)) {
    const document = parse(html);
    scrub(document);
    return serialize(document);
  }

  const fragment = parseFragment(html);
  scrub(fragment);
  return serialize(fragment);
}

/**
 * Report what the sanitiser would remove, for display in the editor.
 *
 * Advisory only. The server sanitises regardless of what the editor shows, so
 * this never has to be exhaustive to be safe — it exists so an author is told
 * why their markup vanished rather than being left to guess.
 */
export function findDisallowedMarkup(html: string): Issue[] {
  if (!html.trim()) return [];

  const issues: Issue[] = [];
  const root = isFullDocument(html)
    ? parse(html, { sourceCodeLocationInfo: true })
    : parseFragment(html, { sourceCodeLocationInfo: true });

  const visit = (node: Node): void => {
    if (isElement(node)) {
      const line = node.sourceCodeLocation?.startLine;
      const tagName = node.tagName.toLowerCase();

      if (!isAllowedElement(node)) {
        issues.push({
          source: "html",
          message: `<${tagName}> is not allowed in documents`,
          ...(line ? { line } : {}),
        });
        // Don't descend: the whole subtree goes, and reporting each node
        // inside a dropped `<script>` would be noise rather than help.
        return;
      }

      for (const attr of node.attrs) {
        const name = attr.name.toLowerCase();
        if (!isAllowedAttribute(tagName, name)) {
          issues.push({
            source: "html",
            message: `The ${name} attribute is not allowed`,
            ...(line ? { line } : {}),
          });
        } else if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attr.value)) {
          issues.push({
            source: "html",
            message: `${name}="${attr.value.slice(0, 30)}" uses a scheme that is not allowed (javascript: and similar cannot run in a document)`,
            ...(line ? { line } : {}),
          });
        }
      }
    }

    if (hasChildNodes(node)) {
      for (const child of node.childNodes) visit(child);
    }
  };

  visit(root);
  return issues;
}

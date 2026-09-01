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
 * Two namespaces are allowlisted, HTML and SVG, each with its own element and
 * attribute sets. They are kept separate because a name means different things
 * in each — see `isAllowedElement`. Anything in a third namespace is dropped.
 *
 * Plain module: no framework imports, so it runs identically in the editor and
 * in the Worker. The editor's copy is advisory; the server's is the boundary.
 */

type Node = DefaultTreeAdapterMap["node"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type Element = DefaultTreeAdapterMap["element"];

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

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
  // `svg` is deliberately absent: parse5 puts it in the SVG namespace, so it
  // is allowed by SVG_ELEMENTS below rather than here.
]);

/**
 * SVG elements permitted in a document, for static vector graphics — icons,
 * logos, diagrams.
 *
 * Names are as parse5 emits them: it applies the HTML spec's SVG case
 * adjustment during tree construction, so `<CLIPPATH>` in the source arrives
 * here as `clipPath`. Matching is therefore case-sensitive, unlike HTML.
 *
 * Absent by design:
 *
 * - `script`, and the `animate`/`set` family, which carry event attributes.
 * - `foreignObject`, the integration point where HTML parsing resumes inside
 *   SVG. Allowing it would let HTML re-enter through a subtree this allowlist
 *   does not govern, which is precisely the hole the namespace split closes.
 * - `a`. SVG's link element is a different element from HTML's with different
 *   attribute handling, and a document icon has no need of it.
 * - `style`, matching the HTML side: authors have a dedicated CSS pane, and a
 *   `<style>` inside SVG is another place for a `</style>` breakout to hide.
 */
const SVG_ELEMENTS = new Set([
  // Root and structure.
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  // Shapes.
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  // Text.
  "text",
  "tspan",
  // Paint servers and masking.
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  // Raster content, subject to the same URL rules as <img>.
  "image",
]);

/**
 * Attributes permitted on SVG elements.
 *
 * A single set rather than a per-element map: SVG presentation attributes are
 * genuinely global — `fill` is as meaningful on `<g>` as on `<path>` — and a
 * per-element split would be a large table that buys no safety, since none of
 * these can execute. The safety comes from the element allowlist above and
 * from `href` being URL-checked like any other.
 *
 * `style` is absent for the same reason as in the HTML set. Event handlers are
 * absent too, and `isAllowedAttribute`'s `on*` guard backs that up.
 */
const SVG_ATTRIBUTES = new Set([
  // Identity and grouping.
  "id",
  "class",
  "lang",
  // Geometry.
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "points",
  "dx",
  "dy",
  "transform",
  "viewBox",
  "preserveAspectRatio",
  "xmlns",
  // Paint.
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "clip-path",
  "mask",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "stroke-miterlimit",
  "opacity",
  "color",
  // Gradients.
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  // Units for masking and patterns.
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  // Text.
  "text-anchor",
  "dominant-baseline",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "word-spacing",
  // References. URL-checked like every other URL attribute; `xlink:href`
  // arrives from parse5 with this same `name` and an xlink prefix, so both
  // spellings are covered by the one entry.
  "href",
  // Presentational, but authors reach for them and they cannot execute.
  "visibility",
  "display",
  "overflow",
  "vector-effect",
  "paint-order",
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
 *
 * This holds even though inline `<svg>` is now allowed. Inline SVG is parsed
 * into the tree and passes through the allowlist element by element; an SVG
 * hidden in a base64 `data:` URL is opaque to the sanitiser, and admitting it
 * would mean decoding and re-sanitising a nested document. Authors who want
 * vector graphics write them inline, where they can be checked.
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

function isAllowedAttribute(el: Element, attrName: string): boolean {
  const name = attrName.toLowerCase();
  // Every `on*` attribute is an event handler. The allowlists below already
  // exclude them, so this is redundant today and no test can distinguish its
  // removal — it is kept as a standing guard for the day someone widens an
  // element's attribute set and does not think about event handlers.
  if (name.startsWith("on")) return false;

  // SVG attributes are matched case-sensitively against the name parse5
  // produced, because SVG has camelCase attributes (`viewBox`) that are
  // distinct from their lowercase spelling.
  if (el.namespaceURI === SVG_NS) return SVG_ATTRIBUTES.has(attrName);

  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  return ELEMENT_ATTRIBUTES[el.tagName.toLowerCase()]?.has(name) ?? false;
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function hasChildNodes(node: Node): node is ParentNode {
  return "childNodes" in node;
}

/**
 * An element is kept only if its name is allowlisted *for its own namespace*.
 *
 * The namespace is load-bearing, not a formality. Several names exist in both
 * HTML and SVG — `title`, `a`, `style`, `image`/`img` — with different parsing
 * rules and different attributes, so a name alone cannot say whether an
 * element is safe. Dispatching on namespace is what keeps SVG's `title` from
 * being mistaken for the HTML one, and what stops `foreignObject` from
 * smuggling HTML back in through a subtree the HTML allowlist never sees.
 *
 * MathML has no allowlist at all and so is dropped wholesale: it has its own
 * script vectors, and nothing in a print document needs it.
 */
function isAllowedElement(el: Element): boolean {
  if (el.namespaceURI === HTML_NS) return ALLOWED_ELEMENTS.has(el.tagName.toLowerCase());
  // parse5 applies the SVG case adjustment during tree construction, so the
  // tag name is already in its canonical form (`clipPath`, `foreignObject`).
  if (el.namespaceURI === SVG_NS) return SVG_ELEMENTS.has(el.tagName);
  return false;
}

/**
 * How deep a document may nest before the rest of that branch is discarded.
 *
 * Both walkers recurse over depth, and a deeply nested document is cheap to
 * send: `"<div>".repeat(20000)` is 100kB and overflowed the stack, surfacing as
 * an unhandled 500 on save and a crashed React tree in the editor. Workers has
 * a smaller stack than Node, so its real ceiling is lower still.
 *
 * A print document is never remotely this deep, so the limit costs nothing
 * legitimate — and truncating one branch keeps the rest of the document rather
 * than failing the whole save.
 */
const MAX_DEPTH = 256;

/** Remove disallowed elements and attributes from a parsed tree, in place. */
function scrub(node: Node, depth = 0): void {
  if (!hasChildNodes(node)) return;

  if (depth >= MAX_DEPTH) {
    node.childNodes = [] as typeof node.childNodes;
    return;
  }

  const kept: Node[] = [];
  for (const child of node.childNodes) {
    if (isElement(child)) {
      if (!isAllowedElement(child)) {
        // Dropped with its subtree. A disallowed element's children are not
        // rescued: `<script>` content is code, and a foreign-namespace subtree
        // is exactly the payload the namespace check exists to remove.
        continue;
      }
      child.attrs = child.attrs.filter(
        (attr) =>
          isAllowedAttribute(child, attr.name) &&
          (!URL_ATTRIBUTES.has(attr.name.toLowerCase()) || isSafeUrl(attr.value)),
      );
    }
    scrub(child, depth + 1);
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

  const visit = (node: Node, depth = 0): void => {
    // Bounded for the same reason as `scrub`: this runs in the editor on every
    // keystroke, and a stack overflow here crashes the React tree.
    if (depth >= MAX_DEPTH) return;

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
        if (!isAllowedAttribute(node, attr.name)) {
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
      for (const child of node.childNodes) visit(child, depth + 1);
    }
  };

  visit(root);
  return issues;
}

/**
 * Neutralise CSS that would escape its `<style>` element.
 *
 * CSS reaches the browser inside `<style>`, and the HTML parser ends that
 * element at the first `</style`. Anything after it is parsed as markup, in
 * HTML context, without ever passing through the allowlist above — so an
 * unsanitised CSS pane is a complete bypass of the HTML sanitiser. It was one:
 * `body{}</style><script>alert(1)</script>` produced a real script element in
 * the rendered document, and `<meta http-equiv=refresh>` and `<iframe>` work
 * there even with JavaScript disabled.
 *
 * Only the closing sequence is touched. `<` is otherwise legal CSS — media
 * queries use it, and content strings may hold anything — so escaping more
 * would break valid stylesheets. The backslash is a CSS escape, inert inside a
 * string or ident but no longer parsed as a tag terminator by the HTML parser.
 *
 * Not a full CSS parser: the property surface is deliberately unrestricted, so
 * this guards the one construct that can leave CSS context.
 */
export function sanitizeCss(css: string): string {
  return css.replace(/<\/(?=\s*style)/gi, "<\\/");
}

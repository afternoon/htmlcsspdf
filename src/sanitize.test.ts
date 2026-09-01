import { describe, expect, it } from "vitest";
import { findDisallowedMarkup, sanitizeCss, sanitizeHtml } from "./sanitize.ts";

/**
 * The sanitiser is the security boundary for stored documents: its output is
 * rendered by a real browser on our infrastructure and served back to users.
 * These tests are the specification of what may survive that boundary.
 */

/** Assert the markup cannot execute code after sanitising. */
function expectInert(html: string) {
  const clean = sanitizeHtml(html);
  expect(clean).not.toMatch(/<script/i);
  expect(clean).not.toMatch(/\son\w+\s*=/i);
  expect(clean).not.toMatch(/javascript:/i);
  return clean;
}

describe("sanitizeHtml", () => {
  describe("code execution", () => {
    it("removes script elements and their contents", () => {
      const clean = expectInert("<p>Hi</p><script>alert(1)</script>");
      expect(clean).toContain("Hi");
      expect(clean).not.toContain("alert");
    });

    it("removes scripts regardless of tag case", () => {
      expectInert("<SCRIPT>alert(1)</SCRIPT>");
      expectInert("<ScRiPt>alert(1)</ScRiPt>");
    });

    it("strips event handler attributes", () => {
      expectInert('<img src="https://example.com/a.png" onerror="alert(1)">');
      expectInert('<p onclick="alert(1)">text</p>');
      expectInert('<body onload="alert(1)">text</body>');
    });

    it("strips event handlers whatever their case or spacing", () => {
      expectInert('<p OnClick="alert(1)">x</p>');
      expectInert('<p onclick = "alert(1)">x</p>');
    });

    it("removes javascript: URLs from links", () => {
      expectInert('<a href="javascript:alert(1)">click</a>');
      expectInert('<a href="JaVaScRiPt:alert(1)">click</a>');
    });

    it("removes javascript: URLs obscured by whitespace or entities", () => {
      // parse5 decodes entities, so the sanitiser sees the decoded value.
      expectInert('<a href="java\tscript:alert(1)">x</a>');
      expectInert('<a href=" javascript:alert(1)">x</a>');
      expectInert('<a href="&#106;avascript:alert(1)">x</a>');
    });

    it("strips every on* attribute, not just the well-known ones", () => {
      // Unknown event handlers must not survive on an element that permits
      // other attributes. The strict per-element allowlist is what removes
      // these today; the `on*` prefix rule in isAllowedAttribute backs it up
      // if that allowlist is ever widened.
      const clean = sanitizeHtml('<a href="https://a.test" onfoo="alert(1)">t</a>');
      expect(clean).toContain("https://a.test");
      expect(clean).not.toMatch(/onfoo/i);

      // Same for an event that did not exist when this was written.
      expect(sanitizeHtml('<p onanimationstart="alert(1)">x</p>')).not.toMatch(
        /onanimationstart/i,
      );
    });

    it("ignores control characters when resolving a URL scheme", () => {
      // Browsers strip TAB, LF and CR before resolving a scheme, so
      // "java&#9;script:" executes. The sanitiser must strip them too, or the
      // value reads as a harmless relative URL and survives.
      for (const gap of ["\t", "\n", "\r", "\u0000", "\u000b", "\u001f"]) {
        const clean = sanitizeHtml(`<a href="java${gap}script:alert(1)">x</a>`);
        expect(clean, JSON.stringify(gap)).not.toMatch(/href=/i);
      }
      // A legitimate URL containing an encoded tab in its *path* is unaffected.
      expect(sanitizeHtml('<a href="https://a.test/a%09b">x</a>')).toContain("a%09b");
    });

    it("rejects data: URLs that are not images", () => {
      // `data:text/html` is a document with its own origin: navigating to one
      // executes whatever it contains. Only image payloads may use the scheme.
      const clean = sanitizeHtml(
        '<a href="data:text/html,<script>alert(1)</script>">t</a>',
      );
      expect(clean).not.toMatch(/href=/i);
      expect(sanitizeHtml('<a href="data:text/javascript,alert(1)">t</a>')).not.toMatch(
        /href=/i,
      );
      expect(
        sanitizeHtml('<a href="data:image/svg+xml,<svg onload=alert(1)>">t</a>'),
      ).not.toMatch(/href=/i);

      // A genuine embedded image still works.
      expect(sanitizeHtml('<img src="data:image/png;base64,AAA">')).toContain(
        "data:image/png",
      );
    });

    it("removes embedding elements that can load active content", () => {
      for (const tag of ["iframe", "object", "embed", "frame", "frameset"]) {
        const clean = sanitizeHtml(`<${tag} src="https://evil.test"></${tag}>`);
        expect(clean, tag).not.toMatch(new RegExp(`<${tag}`, "i"));
      }
    });

    it("removes forms and their controls", () => {
      const clean = sanitizeHtml(
        '<form action="https://evil.test"><input name="a"><button>go</button></form>',
      );
      expect(clean).not.toMatch(/<form|<input|<button/i);
    });

    it("removes link and base elements", () => {
      // <link> would pull a remote stylesheet; <base> rewrites every relative
      // URL in the document.
      expect(
        sanitizeHtml('<link rel="stylesheet" href="https://evil.test/x.css">'),
      ).not.toMatch(/<link/i);
      expect(sanitizeHtml('<base href="https://evil.test/">')).not.toMatch(/<base/i);
    });

    it("strips the script vectors inside an otherwise permitted svg", () => {
      // SVG is allowed for static graphics, so these payloads now arrive
      // inside a root that survives. The element allowlist has to remove them
      // on their own merits rather than relying on the root being dropped.
      expectInert("<svg><script>alert(1)</script></svg>");
      expectInert('<svg><animate onbegin="alert(1)" attributeName="x"></animate></svg>');
      expectInert('<svg><set onbegin="alert(1)" attributeName="x"></set></svg>');
      expectInert('<svg><path d="M0 0" onload="alert(1)"></path></svg>');
    });

    it("removes mathml, which has its own script vectors", () => {
      // MathML has no allowlist, so it goes wholesale — nothing in a print
      // document needs it.
      expectInert("<math><mtext><script>alert(1)</script></mtext></math>");
      expect(sanitizeHtml("<math><mtext>x</mtext></math>")).toBe("");
    });

    it("drops same-named elements reached through foreign content", () => {
      // SVG defines its own `a`, distinct from HTML's, and it is not in the
      // SVG allowlist — so it goes even though its `svg` root now stays.
      const clean = expectInert('<svg><a href="javascript:alert(1)">x</a></svg>');
      expect(clean).not.toMatch(/<a[\s>]/i);

      // `foreignObject` is the integration point where HTML parsing resumes
      // mid-SVG. Excluding it is what stops HTML re-entering through a subtree
      // the HTML allowlist never governs.
      const fo = sanitizeHtml(
        '<svg><foreignObject><a href="javascript:alert(1)">x</a></foreignObject></svg>',
      );
      expect(fo).not.toMatch(/foreignObject/i);
      expect(fo).not.toMatch(/<a[\s>]/i);

      // Content after a foreign subtree is unaffected.
      expect(
        sanitizeHtml('<p><svg></svg><a href="https://ok.test">after</a></p>'),
      ).toContain("https://ok.test");
    });

    it("keeps svg title distinct from the html element of the same name", () => {
      // Both namespaces define `title`. The SVG one is an accessible label on
      // the graphic; it must not be treated as the HTML document title, and
      // must not pick up HTML's attribute set.
      const clean = sanitizeHtml(
        '<svg><title lang="en" href="javascript:alert(1)">Icon</title></svg>',
      );
      expect(clean).toContain("Icon");
      expect(clean).not.toMatch(/javascript:/i);
    });

    it("resists mutation-XSS via malformed nesting", () => {
      // The classic mXSS shapes: a payload that becomes active only after the
      // parser reinterprets it. Serialising a parsed tree is what defeats these.
      expectInert('<noscript><p title="</noscript><img src=x onerror=alert(1)>">');
      expectInert('<svg></p><style><a id="</style><img src=x onerror=alert(1)>">');
      expectInert("<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>");
    });

    it("does not resurrect markup through double-encoded input", () => {
      // Escaped text must stay escaped: re-serialising must not decode it into
      // live markup.
      const clean = sanitizeHtml("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(clean).not.toMatch(/<script/i);
      expect(clean).toContain("&lt;script&gt;");
    });

    it("removes style attributes that could be used to inject", () => {
      // Inline style is not needed: authors have a whole CSS pane.
      const clean = sanitizeHtml('<p style="color:red">x</p>');
      expect(clean).not.toMatch(/style=/i);
    });
  });

  describe("permitted document content", () => {
    it("keeps semantic structure", () => {
      const html =
        "<h1>Title</h1><p>Body <strong>bold</strong> <em>italic</em></p>" +
        "<ul><li>one</li></ul><blockquote>quote</blockquote>";
      expect(sanitizeHtml(html)).toBe(html);
    });

    it("keeps tables intact", () => {
      const html =
        "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>";
      expect(sanitizeHtml(html)).toBe(html);
    });

    it("keeps remote and data images from any host", () => {
      // Deliberate: users may reference images and fonts from the open
      // internet. The rendering browser holds no credentials, so a fetch
      // leaks nothing the author does not already have.
      const remote = '<img src="https://cdn.example.com/logo.png" alt="Logo">';
      expect(sanitizeHtml(remote)).toContain("cdn.example.com/logo.png");

      const insecure = '<img src="http://cdn.example.com/logo.png">';
      expect(sanitizeHtml(insecure)).toContain("http://cdn.example.com/logo.png");

      const data = '<img src="data:image/png;base64,iVBORw0KGgo=">';
      expect(sanitizeHtml(data)).toContain("data:image/png");
    });

    it("keeps http, https and mailto links", () => {
      expect(sanitizeHtml('<a href="https://example.com">x</a>')).toContain(
        "https://example.com",
      );
      expect(sanitizeHtml('<a href="mailto:a@b.com">x</a>')).toContain("mailto:a@b.com");
      expect(sanitizeHtml('<a href="#section">x</a>')).toContain("#section");
    });

    it("keeps class and id, which CSS selectors depend on", () => {
      const html = '<div class="invoice" id="total">x</div>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it("keeps table layout attributes used by print CSS", () => {
      const html = '<td colspan="2" rowspan="3">x</td>';
      expect(sanitizeHtml(html)).toContain('colspan="2"');
      expect(sanitizeHtml(html)).toContain('rowspan="3"');
    });

    it("preserves text content and entities", () => {
      expect(sanitizeHtml("<p>a &amp; b &lt; c</p>")).toContain("&amp;");
    });

    it("passes a realistic invoice through unchanged in substance", () => {
      const invoice = `<h1>Invoice 001</h1>
<img src="https://example.com/logo.png" alt="Logo">
<table><tr><td>Item</td><td>10.00</td></tr></table>
<p class="total">Total: <strong>10.00</strong></p>`;
      const clean = sanitizeHtml(invoice);
      expect(clean).toContain("Invoice 001");
      expect(clean).toContain("example.com/logo.png");
      expect(clean).toContain('class="total"');
      expect(clean).toContain("10.00");
    });
  });

  describe("svg", () => {
    /** A social-profile icon of the shape icon sets actually ship. */
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><title>GitHub</title><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61"/></svg>`;

    it("keeps a realistic icon intact", () => {
      const clean = sanitizeHtml(icon);
      expect(clean).toContain("<svg");
      expect(clean).toContain('viewBox="0 0 24 24"');
      expect(clean).toContain('stroke-linecap="round"');
      expect(clean).toContain("<title>GitHub</title>");
      expect(clean).toContain("<path");
      expect(clean).toContain("M9 19c-5 1.5-5-2.5-7-3");
    });

    it("keeps an icon embedded in document content", () => {
      const clean = sanitizeHtml(
        `<p>Find me on <a href="https://github.test">${icon} GitHub</a></p>`,
      );
      expect(clean).toContain("<svg");
      expect(clean).toContain("github.test");
      expect(clean).toContain("</p>");
    });

    it("keeps the shape, text and gradient elements a graphic needs", () => {
      const clean = sanitizeHtml(
        `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"></stop></linearGradient><clipPath id="c"><rect x="0" y="0" width="4" height="4"></rect></clipPath></defs><g transform="translate(1,1)" clip-path="url(#c)"><circle cx="2" cy="2" r="1" fill="url(#g)"></circle><ellipse cx="1" cy="1" rx="2" ry="3"></ellipse><line x1="0" y1="0" x2="5" y2="5"></line><polyline points="0,0 1,1"></polyline><polygon points="0,0 1,1 2,0"></polygon><text x="1" y="2" font-size="3" text-anchor="middle">hi<tspan dx="1">there</tspan></text></g></svg>`,
      );
      for (const tag of [
        "defs",
        "linearGradient",
        "stop",
        "clipPath",
        "rect",
        "g",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
      ]) {
        expect(clean, tag).toContain(`<${tag}`);
      }
      expect(clean).toContain("there");
    });

    it("preserves camelCase attribute and element names", () => {
      // SVG is case-sensitive where HTML is not: `viewBox` is not `viewbox`,
      // and lowercasing either would silently break the graphic.
      const clean = sanitizeHtml(
        '<svg viewBox="0 0 8 8" preserveAspectRatio="xMidYMid meet"><clipPath clipPathUnits="userSpaceOnUse"><rect width="1" height="1"></rect></clipPath></svg>',
      );
      expect(clean).toContain("viewBox=");
      expect(clean).toContain("preserveAspectRatio=");
      expect(clean).toContain("clipPath");
      expect(clean).toContain("clipPathUnits=");
    });

    it("accepts the case the author wrote, since parse5 adjusts it", () => {
      const clean = sanitizeHtml('<SVG VIEWBOX="0 0 4 4"><PATH D="M0 0"/></SVG>');
      expect(clean).toContain("<svg");
      expect(clean).toContain("viewBox=");
      expect(clean).toContain("<path");
      expect(clean).toContain('d="M0 0"');
    });

    it("strips attributes that are not in the svg allowlist", () => {
      const clean = sanitizeHtml(
        '<svg viewBox="0 0 4 4"><path d="M0 0" style="fill:red" requiredExtensions="x"></path></svg>',
      );
      expect(clean).toContain('d="M0 0"');
      expect(clean).not.toMatch(/style=/i);
      expect(clean).not.toMatch(/requiredExtensions/i);
    });

    it("url-checks href in both its spellings", () => {
      // parse5 reports `xlink:href` with the same attribute name as `href`, so
      // one allowlist entry and one URL check cover both.
      const clean = expectInert(
        '<svg><use xlink:href="javascript:alert(1)"></use><use href="javascript:alert(1)"></use></svg>',
      );
      expect(clean).not.toMatch(/javascript:/i);

      const ok = sanitizeHtml('<svg><use href="#icon"></use></svg>');
      expect(ok).toContain('href="#icon"');
    });

    it("allows image inside svg under the same url rules as img", () => {
      const clean = sanitizeHtml(
        '<svg><image href="https://ok.test/a.png" width="4" height="4"></image></svg>',
      );
      expect(clean).toContain("ok.test/a.png");
      expect(
        expectInert('<svg><image href="javascript:alert(1)"></image></svg>'),
      ).not.toMatch(/javascript:/i);
    });

    it("still refuses an svg data url, which the allowlist cannot inspect", () => {
      // Inline SVG is checked element by element; an SVG inside a base64
      // data: URL is opaque, so it stays out even now that inline SVG is in.
      const clean = sanitizeHtml(
        '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">',
      );
      expect(clean).not.toMatch(/data:image\/svg/i);
    });

    it("drops svg nested inside a disallowed element", () => {
      expect(sanitizeHtml("<script><svg><path d='M0 0'/></svg></script>")).not.toMatch(
        /<svg/i,
      );
    });

    it("keeps a nested svg, which is legal in a graphic", () => {
      const clean = sanitizeHtml(
        '<svg viewBox="0 0 9 9"><svg x="1"><rect width="1" height="1"></rect></svg></svg>',
      );
      expect(clean.match(/<svg/gi)).toHaveLength(2);
      expect(clean).toContain("<rect");
    });
  });

  describe("document structure", () => {
    it("keeps a full document's head and body", () => {
      const clean = sanitizeHtml(
        "<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>",
      );
      expect(clean).toContain("<title>T</title>");
      expect(clean).toContain("<p>x</p>");
    });

    it("keeps a head style element, since it is how authors style a full document", () => {
      const clean = sanitizeHtml(
        "<html><head><style>p{color:red}</style></head><body>x</body></html>",
      );
      expect(clean).toContain("p{color:red}");
    });

    it("drops a style element containing markup that would break out", () => {
      const clean = sanitizeHtml("<style>p{}</style><script>alert(1)</script>");
      expect(clean).not.toMatch(/<script/i);
    });

    it("returns empty output for empty input", () => {
      expect(sanitizeHtml("")).toBe("");
      expect(sanitizeHtml("   ")).toBe("   ");
    });

    it("is idempotent", () => {
      const dirty =
        '<p onclick="x()">hi</p><script>bad()</script><img src="https://a.test/i.png">';
      const once = sanitizeHtml(dirty);
      expect(sanitizeHtml(once)).toBe(once);
    });
  });
});

describe("findDisallowedMarkup", () => {
  it("reports nothing for a clean document", () => {
    expect(findDisallowedMarkup("<h1>Hi</h1><p>There</p>")).toEqual([]);
  });

  it("names the offending element", () => {
    const issues = findDisallowedMarkup("<p>ok</p><script>alert(1)</script>");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("script");
    expect(issues[0].source).toBe("html");
  });

  it("reports the line so the editor can point at it", () => {
    const issues = findDisallowedMarkup("<p>one</p>\n<p>two</p>\n<iframe></iframe>");
    expect(issues[0].line).toBe(3);
  });

  it("names a disallowed attribute", () => {
    const issues = findDisallowedMarkup('<p onclick="alert(1)">x</p>');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("onclick");
  });

  it("reports javascript: URLs", () => {
    const issues = findDisallowedMarkup('<a href="javascript:alert(1)">x</a>');
    expect(issues).toHaveLength(1);
    expect(issues[0].message.toLowerCase()).toContain("javascript:");
  });

  it("does not report permitted remote images", () => {
    expect(findDisallowedMarkup('<img src="https://cdn.example.com/a.png">')).toEqual([]);
  });

  it("reports each distinct problem once", () => {
    const issues = findDisallowedMarkup(
      "<script>a</script><script>b</script><iframe></iframe>",
    );
    expect(issues).toHaveLength(3);
  });
});

describe("sanitizeCss", () => {
  /**
   * CSS reaches the browser inside a <style> element, so anything that can
   * close that element escapes into HTML context — bypassing the HTML
   * allowlist entirely. That was a live vulnerability: `</style><script>` in
   * the CSS pane produced a real script element in the rendered document.
   */
  describe("style element breakout", () => {
    it("neutralises a closing style tag", () => {
      const clean = sanitizeCss("body{}</style><script>alert(1)</script><style>");
      expect(clean).not.toMatch(/<\/style/i);
    });

    it("neutralises it whatever the case or spacing", () => {
      for (const closer of [
        "</style>",
        "</STYLE>",
        "</StYlE>",
        "</style >",
        "</style\t>",
      ]) {
        expect(sanitizeCss(`body{}${closer}<script>x</script>`), closer).not.toMatch(
          /<\/\s*style/i,
        );
      }
    });

    it("leaves the document with no script element after a breakout attempt", async () => {
      const { parse } = await import("parse5");
      const css = sanitizeCss("body{}</style><script>alert(1)</script><style>");
      const doc = parse(
        `<!doctype html><html><head><style>${css}</style></head><body></body></html>`,
      );

      const tags: string[] = [];
      const walk = (n: { tagName?: string; childNodes?: unknown[] }) => {
        if (n.tagName) tags.push(n.tagName);
        for (const c of (n.childNodes ?? []) as (typeof n)[]) walk(c);
      };
      walk(doc as never);

      expect(tags).not.toContain("script");
    });

    it("blocks the vectors that work even with JavaScript disabled", async () => {
      const { parse } = await import("parse5");
      for (const payload of [
        'body{}</style><meta http-equiv="refresh" content="0;url=http://evil.test">',
        "body{}</style><iframe src=http://169.254.169.254/></iframe>",
        'body{}</style><base href="http://evil.test/">',
      ]) {
        const css = sanitizeCss(payload);
        const doc = parse(`<html><head><style>${css}</style></head><body></body></html>`);
        const tags: string[] = [];
        const walk = (n: { tagName?: string; childNodes?: unknown[] }) => {
          if (n.tagName) tags.push(n.tagName);
          for (const c of (n.childNodes ?? []) as (typeof n)[]) walk(c);
        };
        walk(doc as never);

        expect(
          tags.filter((t) => ["iframe", "base"].includes(t)),
          payload,
        ).toEqual([]);
        // The only <meta> permitted is the charset our own shell adds.
        expect(tags.filter((t) => t === "meta").length, payload).toBe(0);
      }
    });
  });

  describe("legitimate stylesheets", () => {
    it("leaves ordinary CSS untouched", () => {
      const css =
        "@page { size: A4; margin: 20mm }\nbody { font-family: Georgia, serif }";
      expect(sanitizeCss(css)).toBe(css);
    });

    it("keeps remote fonts and images, which are deliberately allowed", () => {
      const css =
        "@import url('https://fonts.example.com/x.css');\n" +
        "body { background: url(https://cdn.example.com/bg.png) }";
      expect(sanitizeCss(css)).toBe(css);
    });

    it("keeps comparison operators and arbitrary content strings", () => {
      // `<` is legal in CSS: media queries use it, and content strings may
      // hold anything. Only the style-closing sequence may be touched.
      const css = "@media (width < 40rem) { .a { content: '<b>not markup</b>' } }";
      expect(sanitizeCss(css)).toBe(css);
    });

    it("returns empty input unchanged", () => {
      expect(sanitizeCss("")).toBe("");
    });

    it("is idempotent", () => {
      const once = sanitizeCss("body{}</style><script>x</script>");
      expect(sanitizeCss(once)).toBe(once);
    });
  });
});

describe("pathological input", () => {
  /**
   * Both tree walkers recurse over document depth. A deeply nested document is
   * cheap to send and blew the stack, throwing RangeError out of the save
   * handler as an unhandled 500 — and out of the editor's advisory check as a
   * React crash. Workers has a smaller stack than Node, so the ceiling there
   * is lower than any threshold measured locally.
   */
  const deep = (depth: number) => "<div>".repeat(depth) + "x";

  it("survives a document nested far past anything legitimate", () => {
    // 20k deep overflowed the stack before the depth limit; the API also caps
    // content size, so nothing larger than this reaches the parser at all.
    expect(() => sanitizeHtml(deep(20_000))).not.toThrow();
  });

  it("reports rather than throwing on the same input", () => {
    expect(() => findDisallowedMarkup(deep(20_000))).not.toThrow();
    // Slower than sanitizeHtml: this path asks parse5 for source positions so
    // the editor can point at the offending line. The API caps content size,
    // so nothing this large reaches it in practice.
  }, 15_000);

  it("keeps content that sits within the depth limit", () => {
    const clean = sanitizeHtml("<div><div><div><p>deep enough</p></div></div></div>");
    expect(clean).toContain("deep enough");
  });

  it("drops content nested past the limit rather than failing the whole document", () => {
    // A legitimate print document is never hundreds of levels deep, so
    // truncating beyond the limit costs nothing real and keeps the rest.
    const clean = sanitizeHtml(`<p>kept</p>${deep(5_000)}`);
    expect(clean).toContain("kept");
  });
});

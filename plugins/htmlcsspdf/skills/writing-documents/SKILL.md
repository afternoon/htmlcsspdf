---
name: writing-documents
description: Write, edit and lay out htmlcsspdf documents — HTML plus CSS rendered to PDF. Use when creating or editing a document in htmlcsspdf, when choosing page size, margins, page breaks or print styling for one, or when working out why part of a saved document disappeared or a PDF paginated wrongly.
---

# Writing htmlcsspdf documents

An htmlcsspdf document is two fields: an HTML fragment and a stylesheet. There
is no third field, no template, and no separate page-setup dialog. Everything
about the printed page is decided by the CSS, and what survives a save is
decided by a sanitiser. Those two facts are most of what is worth knowing.

## The tools

| Tool | What it does |
| --- | --- |
| `list_documents` | The user's documents, most recently updated first |
| `get_document` | One document's HTML, CSS and `updatedAt` |
| `create_document` | New document from `name`, `html`, `css` — returns its id |
| `update_document` | Replaces `html` **and** `css` |
| `rename_document` | Changes the name only |
| `delete_document` | Permanent, no undo |

Every result naming a document carries its `url` beside its `id`. Use that
field when telling someone where their document is; do not compose a link out
of an id yourself.

**`update_document` replaces both panes.** There is no patch, and omitting a
field does not leave it alone. Call `get_document` first and send the whole
document back, or you will silently erase the pane you did not think about.

A read-only token gets a server on which the four write tools are not
registered. If you can only see `list_documents` and `get_document`, the token
is read-only — say so rather than reporting a failure.

Rendering is deliberately not a tool. Browser time is a small shared quota, so
the PDF is produced when a person presses Preview in the app; nothing you call
here produces a file.

## Page setup lives in `@page`

Size and margins come from an `@page` rule in the CSS. There is no other page
setup, so a document without one gets the renderer's default rather than the
page you had in mind. Start every stylesheet with it:

```css
@page {
  size: A4;              /* or Letter, A5, or explicit: 210mm 297mm */
  margin: 20mm;
}
```

`size: A4 landscape` rotates. Per-page margins (`@page :first`) work where the
renderer supports them; keep to the simple form unless there is a reason.

Because the output is paper, use absolute units — `pt` and `mm` — for type and
spacing rather than `px` or viewport units. `body { margin: 0 }` is worth
setting explicitly: the page margin is the `@page` margin's job, and a default
body margin stacks on top of it.

Control pagination with the standard properties, which the renderer honours:

```css
h1, h2       { break-after: avoid; }   /* no heading stranded at a page foot */
table, figure { break-inside: avoid; }
.chapter     { break-before: page; }
thead        { display: table-header-group; }  /* repeats on every page */
```

## What a save keeps

Saving runs a sanitiser, and it is an **allowlist** — anything not named is
dropped, not escaped. Write document content, not an application.

Allowed elements, in full:

```
html head body title style
h1–h6 header footer main section article aside nav div p br hr span
ul ol li dl dt dd
table caption colgroup col thead tbody tfoot tr th td
a strong b em i u s small mark abbr cite q code kbd samp var sub sup
time data wbr blockquote pre figure figcaption address ins del img
```

So there is no `<script>`, `<iframe>`, `<form>`, `<input>`, `<button>`,
`<video>`, `<audio>` or `<canvas>`.

Inline `<svg>` **is** allowed, as a static-graphics subset — for icons, logos
and simple diagrams:

```
svg g defs symbol use title desc
path rect circle ellipse line polyline polygon
text tspan
linearGradient radialGradient stop clipPath mask pattern image
```

Inside SVG there is no `<script>`, no `<animate>`/`<set>`, no `<a>`, no
`<style>` and no `<foreignObject>`. Presentation attributes (`fill`, `stroke`,
`stroke-width`, `transform`, `viewBox`, `d`, `points`, the geometry and gradient
attributes, and the `font-*`/`text-anchor` text attributes) are kept; `style` is
not. SVG names are **case-sensitive** — write `viewBox` and `clipPath`, not
`viewbox` or `clippath`. `href` and `xlink:href` are scheme-checked like any
other URL, so keep `<use>` on same-document references such as `href="#icon"`.

Paste icon SVGs inline rather than linking them: a `data:image/svg+xml` URL is
rejected, because only inline SVG can be checked element by element.

Attributes are an allowlist too. Globally: `class`, `id`, `title`, `lang`,
`dir`. Per element: `href`/`target`/`rel` on `a`; `src`/`alt`/`width`/`height`/
`loading` on `img`; `colspan`/`rowspan`/`headers` on `td` and `th` (plus
`scope`/`abbr` on `th`); `span` on `col`/`colgroup`; `start`/`reversed`/`type`
on `ol`; `value` on `li` and `data`; `datetime` on `time`/`ins`/`del`; `cite`
on `q`/`blockquote`. Every `on*` handler and any inline `style` attribute is
stripped — styling belongs in the CSS pane.

URLs are checked by scheme: `http:`, `https:`, `mailto:`, `tel:` and `data:`
are allowed. A `data:` URL must be a raster image (`png`, `jpeg`, `jpg`, `gif`,
`webp`, `avif`, `bmp`) — `data:image/svg+xml` is rejected, so write vector
graphics as inline `<svg>` instead.

The CSS pane is a stylesheet, not markup: it needs no `<style>` wrapper, and
`@page`, `@media print`, custom properties and web fonts all work normally.

## Working on a document

Prefer editing over replacing. `get_document`, change what needs changing, send
the whole thing back with `update_document`, and keep the id — the person may
have the document open, and a delete-then-create hands them a dead link.

Give a document a real name when you create one; `rename_document` exists, but
a name chosen at creation is one fewer round trip. When you are done, tell the
person the `url` from the result and let them press Preview to get the PDF.

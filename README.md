# htmlcsspdf

Write HTML and CSS, get a PDF. Rendered by Cloudflare Browser Run.

Demo: https://htmlcsspdf.ben2.workers.dev/

## Running

```sh
bun install
bun run dev
```

Then open http://localhost:5173. The Cloudflare Vite plugin runs the server
routes in the real Workers runtime, so the `BROWSER` binding works locally and
both client and server code hot-reload — no build step in the loop.

## Deploying

```sh
bun run deploy
```

## How it works

Built on TanStack Start. There is no hand-written Worker entry: `wrangler.jsonc`
points `main` at `@tanstack/react-start/server-entry`, which serves the client
assets and dispatches server routes.

- `src/routes/api.render.ts` — handles `POST /api/render`. Takes `{html, css}`,
  renders with Puppeteer via the `BROWSER` binding, returns PDF bytes. Reaches
  the binding through the `cloudflare:workers` `env` import, so this module must
  stay server-only.
- `src/routes/__root.tsx` — the document shell. Opted out of SSR (`ssr: false`):
  the editors build CodeMirror views against real DOM nodes and the document is
  read from localStorage during render. Revisit if static pages are added.
- `src/routes/index.tsx` — mounts the app at `/`.
- `src/App.tsx` — three-pane UI, render lifecycle, localStorage persistence,
  error overlay, download button.
- `src/App.tsx` — three-pane UI, render lifecycle, localStorage persistence,
  error overlay, download button.
- `src/Editor.tsx` — CodeMirror 6 wrapper.
- `src/Divider.tsx` — draggable split handles.

## Layout

HTML sits above CSS at a 2:1 height ratio; the editor column and the preview
split the width 1:1. Both splits are draggable (and keyboard-nudgeable with
the arrow keys when a divider is focused), clamped to 15–85% so a pane can
never be collapsed shut. The split is remembered in localStorage.

## Validation and formatting

`src/document.ts` validates and formats the editor content — a plain module
with no framework imports, so it is testable without rendering.

- **Validation** runs before every render, so a syntax error costs no browser
  time. Errors surface in the preview overlay with a line number.
- **Format** (toolbar) runs Prettier over both panes. Invalid input is left
  untouched and reports the error rather than mangling the text.

Two notes on parser choice:

- CSS is validated with Prettier's **postcss** parser, not `css-tree`.
  css-tree implements the CSS spec's error recovery and silently auto-closes
  an unclosed block at EOF, so `body { color:` parses clean.
- HTML validation is deliberately lenient. The HTML spec requires parsers to
  recover from unclosed tags, so `<div><p>x</div>` is valid and renders fine.
  Only genuinely unparseable markup (an unterminated tag) is reported.

Prettier is loaded on demand — it is ~395kB and is not needed until the first
render or Format press.

## Rendering

Auto preview is **off by default** — each render costs browser time. Press
**Preview** (or ⌘/Ctrl+Enter) to render on demand. Tick **Auto preview** to
re-render automatically 1s after you stop typing. One render runs on first
load so the pane isn't empty.

Page size and margins come entirely from your CSS `@page` rule
(`preferCSSPageSize: true`). There is no page-setup UI by design.

## Browser Run notes

Works on the Workers **Free** plan: 10 browser-minutes/day, 3 concurrent
browsers, and one *new* browser instance per 20 seconds.

That last limit is why the Worker reuses sessions: it calls
`puppeteer.sessions()` to find an idle session and `puppeteer.connect()`s to
it, only launching a new browser when none is free, and `disconnect()`s
(never `close()`s) so the session stays warm. Cold launch is ~40s; warm
renders are ~2-3s.

## Testing

```sh
npm test          # vitest run
npm run test:watch
```

`src/Editor.test.tsx` guards a subtle regression: the CodeMirror view must
never be recreated while typing. See the compartment note in `Editor.tsx`.

## Gotchas

Do not add `#toolbar=0` to the preview iframe's blob URL — Chrome's PDF
viewer then lays out to zero height and the preview renders blank.
`#navpanes=0&view=FitH` is safe: it hides the page-list sidebar and scales
the page to the pane width.

Pass the `language` extension to `Editor` through a CodeMirror `Compartment`,
never as a `useEffect` dependency. Callers build it inline
(`language={htmlLang()}`), so its identity changes on every render; using it
as a dep tears down and rebuilds the `EditorView` on every keystroke, which
detaches the focused DOM node and drops the cursor.

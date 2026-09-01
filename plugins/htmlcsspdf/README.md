# htmlcsspdf plugin

Connects Claude Code to [htmlcsspdf](https://htmlcsspdf.ben2.com/), so an agent
can write documents in your account: HTML plus CSS, rendered to PDF.

## Install

```sh
/plugin marketplace add afternoon/htmlcsspdf
/plugin install htmlcsspdf@htmlcsspdf
```

The first tool call opens a browser to sign in with Google and asks you to
approve read and write access. Nothing is configured by hand — no API key, no
client id — because the server publishes its own OAuth metadata and the client
discovers it from the initial `401`. Tokens carry `offline_access`, so an agent
that runs unattended is not sent back through consent every hour.

To try it before installing, or to point at a local dev server:

```sh
claude --plugin-dir ./plugins/htmlcsspdf
```

For a local server, change the `url` in `.mcp.json` to
`http://localhost:5173/api/mcp`. The OAuth flow accepts plain HTTP on loopback,
so it works the same way there.

## What you get

Six tools — `list_documents`, `get_document`, `create_document`,
`update_document`, `rename_document`, `delete_document` — each a thin call into
the same code the web app uses, so an agent gets exactly the access the browser
has: the same ownership check on every query, the same sanitiser on every write.
A read-only token gets a server with the write tools unregistered rather than
three tools that always fail.

Every result naming a document carries the `url` a person opens it at, so a link
an agent gives you is the real one rather than one it guessed from an id.

Rendering is not a tool. Browser Run is a small shared quota and an agent would
spend it far faster than a person pressing Preview, so PDFs come from the app.

The bundled `writing-documents` skill carries what the tool descriptions cannot:
that page size and margins come from an `@page` rule and nowhere else, and that
saving runs an element allowlist — no `<script>`, no `<form>`, and no `<svg>`,
which is the one that surprises people.

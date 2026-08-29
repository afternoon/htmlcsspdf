import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { UpdateDocumentSchema } from "../documentsApi.ts";
import { deleteDocument, loadDocument, updateDocument } from "../server/documents.ts";
import { jsonError, withUser } from "../server/session.ts";
import { captureThumbnail, thumbnailKey } from "../server/thumbnails.ts";

/**
 * A single document.
 *
 * Every handler passes the signed-in user's id into the query, so a document
 * belonging to someone else is indistinguishable from one that does not exist.
 * Both answer 404 — telling the caller a document exists but is not theirs
 * would leak that it exists at all.
 */
export const Route = createFileRoute("/api/documents/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, async (user) => {
          const document = await loadDocument(env.DB, params.id, user.id);
          if (!document) return jsonError(404, "Document not found.");
          return Response.json(document);
        }),

      PUT: ({ request, params }) =>
        withUser(request, async (user) => {
          const parsed = UpdateDocumentSchema.safeParse(
            await request.json().catch(() => null),
          );
          if (!parsed.success) return jsonError(400, "Invalid document content.");

          const saved = await updateDocument(env.DB, params.id, user.id, parsed.data);
          if (!saved) return jsonError(404, "Document not found.");

          // See the note in api.documents.ts: waitUntil keeps the capture alive
          // past the response instead of making the user wait for it.
          waitUntil(
            captureThumbnail(
              params.id,
              user.id,
              parsed.data.html,
              parsed.data.css,
              saved.revision,
            ),
          );

          return new Response(null, { status: 204 });
        }),

      DELETE: ({ request, params }) =>
        withUser(request, async (user) => {
          const deleted = await deleteDocument(env.DB, params.id, user.id);
          if (!deleted) return jsonError(404, "Document not found.");

          // The rendered image of a deleted document must go too: it is the
          // user's content, and nothing could ever reach it again to reclaim
          // it. Best-effort, so a failing bucket cannot block the delete.
          await env.THUMBNAILS.delete(thumbnailKey(params.id)).catch(() => {});

          return new Response(null, { status: 204 });
        }),
    },
  },
});

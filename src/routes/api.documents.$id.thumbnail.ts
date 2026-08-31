import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { loadDocument } from "../server/documents.ts";
import { jsonError, withUser } from "../server/session.ts";
import { captureThumbnail, thumbnailKey } from "../server/thumbnails.ts";

/**
 * A document's preview image: served on GET, refreshed on POST.
 *
 * Reading goes through the worker rather than from object storage, so the
 * ownership check happens before the bucket is touched and a thumbnail is only
 * readable by the person whose document it depicts. Object storage is never
 * addressable directly.
 */
export const Route = createFileRoute("/api/documents/$id/thumbnail")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, async (user) => {
          // Ownership first: this is what makes serving through the worker
          // worth the extra hop.
          const document = await loadDocument(env.DB, params.id, user.id);
          if (!document) return jsonError(404, "Document not found.");

          const object = await env.THUMBNAILS.get(thumbnailKey(params.id));
          if (!object) return jsonError(404, "No thumbnail yet.");

          return new Response(object.body, {
            headers: {
              "content-type": "image/webp",
              // Private: the response is user-specific, so a shared cache must
              // never hold it. The URL carries a version so the browser can.
              "cache-control": "private, max-age=31536000, immutable",
            },
          });
        }),

      /**
       * Capture a preview of the stored document.
       *
       * Exists because saving and previewing are paced differently: auto-save
       * writes content on every pause in typing, while a browser render is
       * quota-bound and worth doing only once the editing has settled. The
       * content rendered is read from the database, not taken from the
       * request — the preview must depict the stored document, and a caller
       * that could supply its own content could put any image on the card.
       *
       * Answers immediately: like every other capture, this one runs past the
       * response and a failed render is never an error the user sees.
       */
      POST: ({ request, params }) =>
        withUser(request, async (user) => {
          const document = await loadDocument(env.DB, params.id, user.id);
          if (!document) return jsonError(404, "Document not found.");

          // A stored timestamp means the current revision has already been
          // captured — every content write clears it. Nothing to render, and
          // this is what stops a repeated request costing browser time.
          if (document.thumbnailUpdatedAt !== null) {
            return new Response(null, { status: 204 });
          }

          waitUntil(
            captureThumbnail(
              params.id,
              user.id,
              document.html,
              document.css,
              document.revision,
            ),
          );

          return new Response(null, { status: 202 });
        }),
    },
  },
});

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { loadDocument } from "../server/documents.ts";
import { jsonError, withUser } from "../server/session.ts";
import { thumbnailKey } from "../server/thumbnails.ts";

/**
 * Serves a thumbnail through the worker rather than from object storage.
 *
 * The ownership check happens before the bucket is touched, so a thumbnail is
 * only readable by the person whose document it depicts. Object storage is
 * never addressable directly.
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

          const object = await env.THUMBNAILS?.get(thumbnailKey(params.id));
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
    },
  },
});

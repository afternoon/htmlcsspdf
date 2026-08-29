import { env, waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { SaveDocumentSchema } from "../documentsApi.ts";
import { createDocument, listDocuments } from "../server/documents.ts";
import { jsonError, withUser } from "../server/session.ts";
import { captureThumbnail } from "../server/thumbnails.ts";

export const Route = createFileRoute("/api/documents")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withUser(request, async (user) => {
          return Response.json({ documents: await listDocuments(env.DB, user.id) });
        }),

      POST: ({ request }) =>
        withUser(request, async (user) => {
          const parsed = SaveDocumentSchema.safeParse(
            await request.json().catch(() => null),
          );
          if (!parsed.success) {
            return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid document.");
          }

          const { id, revision } = await createDocument(env.DB, user.id, parsed.data);

          // waitUntil, not awaited: the capture keeps the isolate alive on its
          // own without holding the response, so the user is not waiting on a
          // browser render to be told their document saved. A bare
          // fire-and-forget promise would simply be discarded at teardown.
          waitUntil(
            captureThumbnail(id, user.id, parsed.data.html, parsed.data.css, revision),
          );

          return Response.json({ id }, { status: 201 });
        }),
    },
  },
});

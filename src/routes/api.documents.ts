import { env } from "cloudflare:workers";
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

          const { id } = await createDocument(env.DB, user.id, parsed.data);

          // Awaited, not fire-and-forget: a Worker isolate can be torn down
          // the moment it responds, which silently discarded the capture.
          // captureThumbnail swallows its own errors and bounds its runtime,
          // so this can neither fail nor hang the save.
          await captureThumbnail(id, user.id, parsed.data.html, parsed.data.css);

          return Response.json({ id }, { status: 201 });
        }),
    },
  },
});

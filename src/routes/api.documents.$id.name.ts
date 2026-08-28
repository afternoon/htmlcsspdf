import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { RenameDocumentSchema } from "../documentsApi.ts";
import { renameDocument } from "../server/documents.ts";
import { jsonError, withUser } from "../server/session.ts";

export const Route = createFileRoute("/api/documents/$id/name")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        withUser(request, async (user) => {
          const parsed = RenameDocumentSchema.safeParse(
            await request.json().catch(() => null),
          );
          if (!parsed.success) {
            return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid name.");
          }

          const renamed = await renameDocument(
            env.DB,
            params.id,
            user.id,
            parsed.data.name,
          );
          if (!renamed) return jsonError(404, "Document not found.");

          return new Response(null, { status: 204 });
        }),
    },
  },
});

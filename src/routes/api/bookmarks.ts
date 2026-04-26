import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import {
  createBookmarkForUser,
  deleteBookmarkForUser,
  listBookmarksForUser,
  processBookmarkEmbedding,
  refetchBookmarkMetadataForUser,
  renameBookmarkTitleForUser,
} from "@/lib/bookmarks/functions";
import { inngest } from "@/lib/inngest/client";

export const Route = createFileRoute("/api/bookmarks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const bookmarks = await listBookmarksForUser(userId);
        return Response.json(bookmarks);
      },
      POST: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = (await request.json()) as {
          url?: string;
          note?: string;
          folder?: string;
          category?: string;
        };
        const created = await createBookmarkForUser(userId, {
          url: payload.url ?? "",
          note: payload.note ?? "",
          folder: payload.folder ?? payload.category ?? "default",
        });

        // Queue background embedding/indexing through Inngest.
        // Awaiting send avoids request-scope cancellation in local Worker runtime.
        try {
          await inngest.send({
            id: `bookmark-index-${created.id}`,
            name: "bookmark/index.requested",
            data: {
              bookmarkId: created.id,
              userId,
            },
          });
        } catch {
          // Fallback path if the event cannot be published.
          void processBookmarkEmbedding(created.id);
        }

        return Response.json(
          { success: true, id: created.id, embeddingStatus: "pending" },
          { status: 201 },
        );
      },
      PATCH: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = (await request.json()) as { id?: string; title?: string; action?: string };
        const bookmarkId = payload.id?.trim() ?? "";
        const title = payload.title?.trim() ?? "";

        if (!bookmarkId) {
          return Response.json({ error: "Bookmark id is required." }, { status: 400 });
        }

        if (payload.action === "refetch-metadata") {
          const refetched = await refetchBookmarkMetadataForUser(userId, bookmarkId);
          if (!refetched) {
            return Response.json({ error: "Bookmark not found." }, { status: 404 });
          }

          return Response.json({ success: true, id: bookmarkId });
        }

        if (!title) {
          return Response.json({ error: "Title is required." }, { status: 400 });
        }

        const renamed = await renameBookmarkTitleForUser(userId, bookmarkId, title);
        if (!renamed) {
          return Response.json({ error: "Bookmark not found." }, { status: 404 });
        }

        return Response.json({ success: true, id: bookmarkId, title });
      },
      DELETE: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = (await request.json()) as { id?: string };
        const bookmarkId = payload.id?.trim() ?? "";
        if (!bookmarkId) {
          return Response.json({ error: "Bookmark id is required." }, { status: 400 });
        }

        const deleted = await deleteBookmarkForUser(userId, bookmarkId);
        if (!deleted) {
          return Response.json({ error: "Bookmark not found." }, { status: 404 });
        }

        return Response.json({ success: true, id: bookmarkId });
      },
    },
  },
});

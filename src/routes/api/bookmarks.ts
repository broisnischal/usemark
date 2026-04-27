import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import {
  createBookmarksBatchForUser,
  createBookmarkForUser,
  deleteBookmarkForUser,
  deleteBookmarksForUser,
  listBookmarksForUser,
  processBookmarkEmbedding,
  refetchBookmarkMetadataForUser,
  renameBookmarkTitleForUser,
  requestBookmarkEmbeddingForUser,
  updateBookmarkFlagsForUser,
} from "@/lib/bookmarks/functions";
import { inngest } from "@/lib/inngest/client";

const IMPORT_INITIAL_BATCH_SIZE = 25;

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

        const requestUrl = new URL(request.url);
        const folderId = requestUrl.searchParams.get("folderId");
        const limitParam = requestUrl.searchParams.get("limit");
        const parsedLimit = limitParam ? Number(limitParam) : null;
        const limit = Number.isFinite(parsedLimit) && (parsedLimit ?? 0) > 0 ? parsedLimit : null;
        const bookmarks = await listBookmarksForUser(userId, { folderId, limit });
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
          items?: Array<{
            url?: string;
            note?: string;
            folder?: string;
            category?: string;
            title?: string | null;
          }>;
        };

        const importItems = Array.isArray(payload.items)
          ? payload.items
              .map((item) => {
                const url = item.url?.trim() ?? "";
                if (!url) {
                  return null;
                }
                return {
                  url,
                  note: item.note,
                  folder: item.folder,
                  category: item.category,
                  title: item.title,
                };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null)
          : [];
        if (importItems.length > 0) {
          const immediateItems = importItems.slice(0, IMPORT_INITIAL_BATCH_SIZE);
          const deferredItems = importItems.slice(IMPORT_INITIAL_BATCH_SIZE);
          const immediateResult = await createBookmarksBatchForUser(userId, immediateItems, {
            dedupeByUrlAndFolder: true,
          });

          try {
            await inngest.send(
              immediateResult.createdIds.map((bookmarkId) => ({
                id: `bookmark-index-${bookmarkId}`,
                name: "bookmark/index.requested",
                data: { bookmarkId, userId },
              })),
            );
          } catch {
            await Promise.all(
              immediateResult.createdIds.map((bookmarkId) => processBookmarkEmbedding(bookmarkId)),
            );
          }

          if (deferredItems.length > 0) {
            try {
              await inngest.send({
                id: `bookmark-import-${userId}-${Date.now()}`,
                name: "bookmark/import.requested",
                data: {
                  userId,
                  items: deferredItems,
                },
              });
            } catch {
              const deferredResult = await createBookmarksBatchForUser(userId, deferredItems, {
                dedupeByUrlAndFolder: true,
              });
              await Promise.all(
                deferredResult.createdIds.map((bookmarkId) => processBookmarkEmbedding(bookmarkId)),
              );
            }
          }

          return Response.json(
            {
              success: true,
              mode: "bulk-import",
              createdNow: immediateResult.createdIds.length,
              queued: deferredItems.length,
              skipped: immediateResult.skippedCount,
            },
            { status: 201 },
          );
        }
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

        const payload = (await request.json()) as {
          id?: string;
          title?: string;
          action?: string;
          force?: boolean;
          saveForLater?: boolean;
          isImportant?: boolean;
          isCompleted?: boolean;
          visibility?: "private" | "public";
        };
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

        if (payload.action === "update-flags") {
          const updated = await updateBookmarkFlagsForUser(userId, bookmarkId, {
            saveForLater: payload.saveForLater,
            isImportant: payload.isImportant,
            isCompleted: payload.isCompleted,
            visibility: payload.visibility,
          });
          if (!updated) {
            return Response.json({ error: "Bookmark not found." }, { status: 404 });
          }
          return Response.json({
            success: true,
            id: bookmarkId,
            saveForLater: payload.saveForLater,
            isImportant: payload.isImportant,
            isCompleted: payload.isCompleted,
            visibility: payload.visibility,
          });
        }

        if (payload.action === "request-embedding") {
          const requested = await requestBookmarkEmbeddingForUser(userId, bookmarkId, {
            force: payload.force,
          });
          if (!requested) {
            return Response.json({ error: "Bookmark not found." }, { status: 404 });
          }

          try {
            await inngest.send({
              id: `bookmark-index-${bookmarkId}-${Date.now()}`,
              name: "bookmark/index.requested",
              data: {
                bookmarkId,
                userId,
                force: payload.force ?? true,
              },
            });
          } catch {
            void processBookmarkEmbedding(bookmarkId, { force: payload.force ?? true });
          }

          return Response.json({ success: true, id: bookmarkId, embeddingStatus: "pending" });
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

        const payload = (await request.json()) as { id?: string; ids?: string[] };
        if (Array.isArray(payload.ids) && payload.ids.length > 0) {
          const result = await deleteBookmarksForUser(userId, payload.ids);
          return Response.json({ success: true, deletedCount: result.deletedCount });
        }
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

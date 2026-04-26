import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import {
  createBookmarkFolderForUser,
  deleteBookmarkFolderForUser,
  fetchRssChannelName,
  listBookmarkFoldersForUser,
  markBookmarkFolderSeenForUser,
  pinBookmarkFolderForUser,
  processBookmarkEmbedding,
  syncRssBookmarkFolder,
  type BookmarkFolderSourceType,
} from "@/lib/bookmarks/functions";
import { inngest } from "@/lib/inngest/client";

function normalizeSourceType(value: string | undefined): BookmarkFolderSourceType {
  if (value === "rss" || value === "github" || value === "x" || value === "reddit") {
    return value;
  }

  return "local";
}

export const Route = createFileRoute("/api/bookmark-folders")({
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

        const folders = await listBookmarkFoldersForUser(userId);
        return Response.json(folders);
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
          name?: string;
          sourceType?: string;
          syncEnabled?: boolean;
          externalAccountId?: string | null;
          externalResourceId?: string | null;
        };
        const sourceType = normalizeSourceType(payload.sourceType);
        const feedUrl = payload.externalResourceId?.trim() ?? "";
        let feedHost = "";
        if (sourceType === "rss" && feedUrl) {
          try {
            feedHost = new URL(feedUrl).hostname.replace(/^www\./, "");
          } catch {
            return Response.json({ error: "Enter a valid RSS feed URL." }, { status: 400 });
          }
        }
        let name = payload.name?.trim() || feedHost;
        if (!name) {
          return Response.json({ error: "Folder name is required." }, { status: 400 });
        }

        if (sourceType === "rss" && !feedUrl) {
          return Response.json({ error: "RSS feed URL is required." }, { status: 400 });
        }

        if (sourceType === "rss" && !payload.name?.trim()) {
          name = await fetchRssChannelName(feedUrl);
        }

        const folder = await createBookmarkFolderForUser(userId, {
          name,
          sourceType,
          syncEnabled: payload.syncEnabled ?? sourceType !== "local",
          externalAccountId: payload.externalAccountId ?? null,
          externalResourceId: feedUrl || null,
        });

        if (folder.sourceType === "rss") {
          try {
            await inngest.send({
              id: `rss-folder-sync-${folder.id}-${Date.now()}`,
              name: "bookmark-folder/rss.sync.requested",
              data: {
                folderId: folder.id,
                userId,
              },
            });
          } catch {
            void syncRssBookmarkFolder(folder.id)
              .then(async (result) => {
                await Promise.all(result.bookmarkIds.map((bookmarkId) => processBookmarkEmbedding(bookmarkId)));
              })
              .catch(() => {});
          }
        }

        return Response.json(folder, { status: 201 });
      },
      PATCH: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = (await request.json()) as { id?: string; action?: string };
        const folderId = payload.id?.trim() ?? "";
        if (!folderId) {
          return Response.json({ error: "Folder id is required." }, { status: 400 });
        }

        if (payload.action === "mark-seen") {
          await markBookmarkFolderSeenForUser(userId, folderId);
          return Response.json({ success: true, id: folderId });
        }

        if (payload.action === "pin") {
          const pinned = await pinBookmarkFolderForUser(userId, folderId);
          if (!pinned) {
            return Response.json({ error: "Folder not found." }, { status: 404 });
          }

          return Response.json({ success: true, id: folderId });
        }

        return Response.json({ error: "Unsupported action." }, { status: 400 });
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
        const folderId = payload.id?.trim() ?? "";
        if (!folderId) {
          return Response.json({ error: "Folder id is required." }, { status: 400 });
        }

        const deleteResult = await deleteBookmarkFolderForUser(userId, folderId);
        if (deleteResult === "protected") {
          return Response.json({ error: "The default folder cannot be deleted." }, { status: 400 });
        }

        if (deleteResult === "not-found") {
          return Response.json({ error: "Folder not found." }, { status: 404 });
        }

        return Response.json({ success: true, id: folderId });
      },
    },
  },
});

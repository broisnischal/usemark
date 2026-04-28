import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import {
  createBookmarkFolderForUser,
  deleteBookmarkFolderForUser,
  fetchRssChannelName,
  listBookmarkFoldersForUser,
  markBookmarkFolderSeenForUser,
  pinBookmarkFolderForUser,
  syncGitHubBookmarkFolder,
  syncRssBookmarkFolder,
  unfollowRssBookmarkFolderForUser,
  updateRssFolderSettingsForUser,
  type BookmarkFolderSourceType,
} from "@/lib/bookmarks/functions";
import {
  normalizeGitHubRepo,
  normalizeGitHubResourceType,
  toGitHubExternalResourceId,
} from "@/lib/bookmarks/github";
import { ensureStarterRssFoldersForUser } from "@/lib/bookmarks/starter-feeds";
import { inngest } from "@/lib/inngest/client";

const RSS_IMMEDIATE_INSERT_LIMIT = 15;
const GITHUB_IMMEDIATE_INSERT_LIMIT = 25;

async function queueBookmarkIndexEvents(bookmarkIds: string[]) {
  if (bookmarkIds.length === 0) {
    return;
  }
  await inngest.send(
    bookmarkIds.map((bookmarkId) => ({
      id: `bookmark-index-${bookmarkId}`,
      name: "bookmark/index.requested",
      data: { bookmarkId },
    })),
  );
}

async function queueDeferredImportEvent(
  userId: string | null,
  folderId: string,
  deferredItems: Array<{
    url: string;
    note?: string;
    folder?: string;
    category?: string;
    folderId?: string;
    title?: string | null;
    sourceItemId?: string | null;
    createdAt?: Date | string;
    tag?: string;
    contentType?: "link" | "text";
  }>,
) {
  if (!userId || deferredItems.length === 0) {
    return;
  }
  await inngest.send({
    id: `bookmark-import-rss-${folderId}-${Date.now()}`,
    name: "bookmark/import.requested",
    data: {
      userId,
      sourceFolderId: folderId,
      items: deferredItems.map((item) => ({
        ...item,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : item.createdAt instanceof Date
              ? item.createdAt.toISOString()
              : undefined,
      })),
    },
  });
}

async function runImmediateRssSync(folderId: string) {
  return syncRssBookmarkFolder(folderId, {
    immediateInsertLimit: RSS_IMMEDIATE_INSERT_LIMIT,
  });
}

async function runRssSyncFastAndQueue(folderId: string) {
  const result = await runImmediateRssSync(folderId);
  try {
    await queueBookmarkIndexEvents(result.bookmarkIds);
    await queueDeferredImportEvent(result.userId, folderId, result.deferredItems);
  } catch {
    // Avoid request-time heavy fallbacks in Worker runtime.
  }
  return result;
}

async function runImmediateGitHubSync(folderId: string) {
  return syncGitHubBookmarkFolder(folderId, {
    immediateInsertLimit: GITHUB_IMMEDIATE_INSERT_LIMIT,
  });
}

async function runGitHubSyncFastAndQueue(folderId: string) {
  const result = await runImmediateGitHubSync(folderId);
  try {
    await queueBookmarkIndexEvents(result.bookmarkIds);
    await queueDeferredImportEvent(result.userId, folderId, result.deferredItems);
  } catch {
    // Avoid request-time heavy fallbacks in Worker runtime.
  }
  return result;
}

function normalizeSourceType(value: string | undefined): BookmarkFolderSourceType {
  if (
    value === "todo" ||
    value === "rss" ||
    value === "github" ||
    value === "x" ||
    value === "reddit"
  ) {
    return value;
  }

  return "local";
}

function isTodoFolderName(name: string | undefined) {
  const normalized = name?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }
  return (
    normalized === "todo" ||
    normalized.startsWith("todo:") ||
    normalized.startsWith("todo-") ||
    normalized.includes(" todo")
  );
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

        await ensureStarterRssFoldersForUser(userId);
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
        let sourceType = normalizeSourceType(payload.sourceType);
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

        if (sourceType === "local" && isTodoFolderName(name)) {
          sourceType = "todo";
        }

        if (sourceType === "rss" && !feedUrl) {
          return Response.json({ error: "RSS feed URL is required." }, { status: 400 });
        }

        if (sourceType === "rss" && !payload.name?.trim()) {
          name = await fetchRssChannelName(feedUrl);
        }

        let externalResourceId = feedUrl || payload.externalResourceId?.trim() || null;
        if (sourceType === "github") {
          const repo = normalizeGitHubRepo(payload.externalResourceId ?? "");
          if (!repo) {
            return Response.json(
              { error: "Enter a GitHub repository as owner/repo." },
              { status: 400 },
            );
          }

          const resourceType = normalizeGitHubResourceType(payload.name);
          externalResourceId = toGitHubExternalResourceId(repo, resourceType);
          name = `${repo} ${resourceType}`;
        }

        const folder = await createBookmarkFolderForUser(userId, {
          name,
          sourceType,
          syncEnabled: payload.syncEnabled ?? (sourceType !== "local" && sourceType !== "todo"),
          externalAccountId: payload.externalAccountId ?? null,
          externalResourceId,
        });

        if (folder.sourceType === "rss") {
          await runRssSyncFastAndQueue(folder.id);
        }

        if (folder.sourceType === "github") {
          await runGitHubSyncFastAndQueue(folder.id);
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

        const payload = (await request.json()) as {
          id?: string;
          action?: string;
          syncIntervalMinutes?: number;
          rssFetchLimit?: number;
          rssKeepRecentCount?: number;
        };
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

        if (payload.action === "sync") {
          const folders = await listBookmarkFoldersForUser(userId);
          const folder = folders.find((item) => item.id === folderId);
          if (!folder) {
            return Response.json({ error: "Folder not found." }, { status: 404 });
          }

          if (folder.sourceType === "local") {
            return Response.json(
              { error: "Manual folders do not have an external source to sync." },
              { status: 400 },
            );
          }

          if (folder.sourceType === "rss") {
            const result = await runRssSyncFastAndQueue(folder.id);
            return Response.json({
              success: true,
              id: folderId,
              sourceType: folder.sourceType,
              importedNow: result.added,
              queued: result.deferredItems.length,
            });
          }

          if (folder.sourceType === "x") {
            return Response.json({ success: true, id: folderId, sourceType: folder.sourceType });
          }

          if (folder.sourceType === "github") {
            const result = await runGitHubSyncFastAndQueue(folder.id);
            return Response.json({
              success: true,
              id: folderId,
              sourceType: folder.sourceType,
              importedNow: result.added,
              queued: result.deferredItems.length,
            });
          }

          return Response.json(
            { error: `${folder.sourceType} folder sync is not available yet.` },
            { status: 400 },
          );
        }

        if (payload.action === "configure-sync") {
          const updated = await updateRssFolderSettingsForUser(userId, folderId, {
            syncIntervalMinutes: payload.syncIntervalMinutes,
            rssFetchLimit: payload.rssFetchLimit,
            rssKeepRecentCount: payload.rssKeepRecentCount,
          });
          if (!updated) {
            return Response.json({ error: "RSS folder not found." }, { status: 404 });
          }
          return Response.json({ success: true, folder: updated });
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

        const payload = (await request.json()) as { id?: string; action?: string };
        const folderId = payload.id?.trim() ?? "";
        if (!folderId) {
          return Response.json({ error: "Folder id is required." }, { status: 400 });
        }

        if (payload.action === "unfollow") {
          const result = await unfollowRssBookmarkFolderForUser(userId, folderId);
          if (result.status === "not-found") {
            return Response.json({ error: "Folder not found." }, { status: 404 });
          }
          if (result.status === "not-rss") {
            return Response.json({ error: "Only RSS folders can be unfollowed." }, { status: 400 });
          }
          if (result.status === "protected") {
            return Response.json(
              { error: "The default folder cannot be deleted." },
              { status: 400 },
            );
          }
          return Response.json({
            success: true,
            id: folderId,
            movedImportant: result.movedImportant,
            importantFolderId: result.importantFolderId ?? null,
          });
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

import "@tanstack/react-start/server-only";
import { NonRetriableError } from "inngest";

import {
  bookmarkFolderExistsForUser,
  createBookmarksBatchForUser,
  listDueRssBookmarkFolderIds,
  processBookmarkEmbedding,
  syncRssBookmarkFolder,
} from "@/lib/bookmarks/functions";

import { inngest } from "./client";

const RSS_INITIAL_INSERT_LIMIT = 25;
const IMPORT_BACKGROUND_CHUNK_SIZE = 50;

async function queueBookmarkEmbeddingEvents(bookmarkIds: string[]) {
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

export const bookmarkImportRequested = inngest.createFunction(
  {
    id: "bookmark-import-requested",
    retries: 2,
    triggers: { event: "bookmark/import.requested" },
  },
  async ({ event, step }) => {
    const payload =
      (event.data as {
        userId?: string;
        sourceFolderId?: string;
        items?: Array<{
          url?: string;
          note?: string;
          folder?: string;
          folderId?: string;
          category?: string;
          title?: string | null;
          sourceItemId?: string | null;
          createdAt?: string;
          tag?: string;
          contentType?: "link" | "text";
        }>;
      }) ?? {};
    const userId = payload.userId?.trim() ?? "";
    const sourceFolderId = payload.sourceFolderId?.trim() ?? "";
    const items = Array.isArray(payload.items)
      ? payload.items
          .map((item) => {
            const url = item.url?.trim() ?? "";
            if (!url) {
              return null;
            }
            return {
              ...item,
              url,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];

    if (!userId || items.length === 0) {
      throw new NonRetriableError(
        "Missing userId/items in bookmark/import.requested event payload.",
      );
    }

    if (sourceFolderId) {
      const sourceFolderExists = await step.run("check-source-folder-exists", async () => {
        return bookmarkFolderExistsForUser(userId, sourceFolderId);
      });
      if (!sourceFolderExists) {
        // Folder was removed. Stop processing this queued import chain.
        return;
      }
    }

    const currentChunk = items.slice(0, IMPORT_BACKGROUND_CHUNK_SIZE);
    const remainingItems = items.slice(IMPORT_BACKGROUND_CHUNK_SIZE);
    const result = await step.run("import-bookmark-chunk", async () => {
      return createBookmarksBatchForUser(userId, currentChunk, {
        dedupeByUrlAndFolder: true,
      });
    });

    await step.run("queue-imported-bookmark-embeddings", async () => {
      await queueBookmarkEmbeddingEvents(
        result.createdIds.filter((bookmarkId): bookmarkId is string => Boolean(bookmarkId)),
      );
    });

    if (remainingItems.length > 0) {
      await step.run("queue-next-import-chunk", async () => {
        await inngest.send({
          id: `bookmark-import-${userId}-${Date.now()}-${remainingItems.length}`,
          name: "bookmark/import.requested",
          data: {
            userId,
            sourceFolderId: sourceFolderId || undefined,
            items: remainingItems,
          },
        });
      });
    }
  },
);

export const bookmarkIndexRequested = inngest.createFunction(
  {
    id: "bookmark-index-requested",
    retries: 3,
    triggers: { event: "bookmark/index.requested" },
  },
  async ({ event, step }) => {
    const bookmarkIdFromEventId =
      typeof event.id === "string" && event.id.startsWith("bookmark-index-")
        ? event.id.replace("bookmark-index-", "")
        : undefined;

    const bookmarkId =
      (event.data as { bookmarkId?: string } | undefined)?.bookmarkId ??
      (event.data as { data?: { bookmarkId?: string } } | undefined)?.data?.bookmarkId ??
      undefined;
    const resolvedBookmarkId = bookmarkId ?? bookmarkIdFromEventId;
    const force =
      (event.data as { force?: boolean } | undefined)?.force ??
      (event.data as { data?: { force?: boolean } } | undefined)?.data?.force ??
      false;

    if (!resolvedBookmarkId) {
      throw new NonRetriableError("Missing bookmarkId in bookmark/index.requested event payload.");
    }

    await step.run("process-bookmark-embedding", async () => {
      await processBookmarkEmbedding(resolvedBookmarkId, { force });
    });
  },
);

export const rssFolderSyncRequested = inngest.createFunction(
  {
    id: "rss-folder-sync-requested",
    retries: 3,
    triggers: { event: "bookmark-folder/rss.sync.requested" },
  },
  async ({ event, step }) => {
    const folderId =
      (event.data as { folderId?: string } | undefined)?.folderId ??
      (event.data as { data?: { folderId?: string } } | undefined)?.data?.folderId ??
      undefined;

    if (!folderId) {
      throw new NonRetriableError(
        "Missing folderId in bookmark-folder/rss.sync.requested event payload.",
      );
    }

    const result = await step.run("sync-rss-folder", async () => {
      return syncRssBookmarkFolder(folderId, { immediateInsertLimit: RSS_INITIAL_INSERT_LIMIT });
    });

    await step.run("queue-rss-bookmark-embeddings", async () => {
      await queueBookmarkEmbeddingEvents(
        result.bookmarkIds.filter((bookmarkId): bookmarkId is string => Boolean(bookmarkId)),
      );
    });

    if (result.userId && result.deferredItems.length > 0) {
      await step.run("queue-rss-deferred-import", async () => {
        await inngest.send({
          id: `bookmark-import-rss-${folderId}-${Date.now()}`,
          name: "bookmark/import.requested",
          data: {
            userId: result.userId,
            sourceFolderId: folderId,
            items: result.deferredItems.map((item) => ({
              ...item,
              createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
            })),
          },
        });
      });
    }
  },
);

export const rssFolderScheduledSync = inngest.createFunction(
  {
    id: "rss-folder-scheduled-sync",
    retries: 1,
    triggers: { cron: "*/30 * * * *" },
  },
  async ({ step }) => {
    const folderIds = await step.run("list-rss-folders", async () => {
      return listDueRssBookmarkFolderIds();
    });

    await Promise.all(
      folderIds.map(async (folderId) => {
        const result = await step.run(`sync-rss-folder-${folderId}`, async () => {
          return syncRssBookmarkFolder(folderId, {
            immediateInsertLimit: RSS_INITIAL_INSERT_LIMIT,
          });
        });

        await step.run(`queue-rss-bookmark-embeddings-${folderId}`, async () => {
          await queueBookmarkEmbeddingEvents(
            result.bookmarkIds.filter((bookmarkId): bookmarkId is string => Boolean(bookmarkId)),
          );
        });

        if (result.userId && result.deferredItems.length > 0) {
          await step.run(`queue-rss-deferred-import-${folderId}`, async () => {
            await inngest.send({
              id: `bookmark-import-rss-scheduled-${folderId}-${Date.now()}`,
              name: "bookmark/import.requested",
              data: {
                userId: result.userId,
                sourceFolderId: folderId,
                items: result.deferredItems.map((item) => ({
                  ...item,
                  createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
                })),
              },
            });
          });
        }
      }),
    );
  },
);

export const inngestFunctions = [
  bookmarkIndexRequested,
  bookmarkImportRequested,
  rssFolderSyncRequested,
  rssFolderScheduledSync,
];

import "@tanstack/react-start/server-only";
import { NonRetriableError } from "inngest";

import {
  listDueRssBookmarkFolderIds,
  processBookmarkEmbedding,
  syncRssBookmarkFolder,
} from "@/lib/bookmarks/functions";

import { inngest } from "./client";

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

    if (!resolvedBookmarkId) {
      throw new NonRetriableError("Missing bookmarkId in bookmark/index.requested event payload.");
    }

    await step.run("process-bookmark-embedding", async () => {
      await processBookmarkEmbedding(resolvedBookmarkId);
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
      throw new NonRetriableError("Missing folderId in bookmark-folder/rss.sync.requested event payload.");
    }

    const result = await step.run("sync-rss-folder", async () => {
      return syncRssBookmarkFolder(folderId);
    });

    await step.run("queue-rss-bookmark-embeddings", async () => {
      await queueBookmarkEmbeddingEvents(result.bookmarkIds);
    });
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
          return syncRssBookmarkFolder(folderId);
        });

        await step.run(`queue-rss-bookmark-embeddings-${folderId}`, async () => {
          await queueBookmarkEmbeddingEvents(result.bookmarkIds);
        });
      }),
    );
  },
);

export const inngestFunctions = [bookmarkIndexRequested, rssFolderSyncRequested, rssFolderScheduledSync];

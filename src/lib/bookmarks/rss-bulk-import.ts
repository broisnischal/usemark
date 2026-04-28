import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";

import { createBookmarkFolderForUser, syncRssBookmarkFolder } from "@/lib/bookmarks/functions";
import { db } from "@/lib/db";
import { bookmarkFolder } from "@/lib/db/schema/bookmark.schema";
import { inngest } from "@/lib/inngest/client";

const MAX_BULK_FEEDS = 200;
const IMMEDIATE_SYNC_FOLDERS_LIMIT = 3;

function normalizeHttpsFeedUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export type RssBulkImportItem = {
  name: string;
  feedUrl: string;
};

export type RssBulkImportResult = {
  created: number;
  skipped: number;
  invalid: number;
};

/**
 * Creates RSS live folders and queues background sync (Inngest) for each new folder.
 * Skips invalid URLs, in-batch duplicates, and feeds the user already follows.
 */
export async function bulkImportRssFeedFolders(
  userId: string,
  items: RssBulkImportItem[],
): Promise<RssBulkImportResult> {
  let created = 0;
  let skipped = 0;
  let invalid = 0;
  const queuedFolderIds: string[] = [];
  const seenInRequest = new Set<string>();

  const capped = items.slice(0, MAX_BULK_FEEDS);

  for (const raw of capped) {
    const feedUrl = normalizeHttpsFeedUrl(raw.feedUrl);
    if (!feedUrl) {
      invalid += 1;
      continue;
    }
    if (seenInRequest.has(feedUrl)) {
      skipped += 1;
      continue;
    }
    seenInRequest.add(feedUrl);

    const existing = await db
      .select({ id: bookmarkFolder.id })
      .from(bookmarkFolder)
      .where(
        and(
          eq(bookmarkFolder.userId, userId),
          eq(bookmarkFolder.sourceType, "rss"),
          eq(bookmarkFolder.externalResourceId, feedUrl),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      skipped += 1;
      continue;
    }

    const name = raw.name.trim() || feedUrl;
    const folder = await createBookmarkFolderForUser(userId, {
      name,
      sourceType: "rss",
      externalResourceId: feedUrl,
      syncEnabled: true,
    });
    created += 1;
    queuedFolderIds.push(folder.id);
  }

  if (queuedFolderIds.length > 0) {
    const now = Date.now();
    // Best-effort immediate sync so the feed shows up right away even if Inngest isn't running locally.
    for (const folderId of queuedFolderIds.slice(0, IMMEDIATE_SYNC_FOLDERS_LIMIT)) {
      try {
        await syncRssBookmarkFolder(folderId);
      } catch {
        // Ignore; background sync will still be queued below.
      }
    }

    // Also queue the normal background sync pipeline (embeddings + deferred items).
    try {
      await inngest.send(
        queuedFolderIds.map((folderId, index) => ({
          id: `rss-bulk-sync-${folderId}-${now}-${index}`,
          name: "bookmark-folder/rss.sync.requested" as const,
          data: { folderId },
        })),
      );
    } catch {
      // Don't fail the UI follow action if Inngest is unavailable.
    }
  }

  return { created, skipped, invalid };
}

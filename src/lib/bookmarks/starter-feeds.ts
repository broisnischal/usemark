import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";

import { createBookmarkFolderForUser } from "@/lib/bookmarks/functions";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema/auth.schema";
import { bookmarkFolder } from "@/lib/db/schema/bookmark.schema";
import { inngest } from "@/lib/inngest/client";

/** Default live folders for new accounts (idempotent per user). */
export const DEFAULT_SIGNUP_RSS_FEEDS = [
  {
    name: "hacker news — front page",
    feedUrl: "https://hnrss.org/frontpage",
  },
] as const;

/**
 * One-time per user: creates default RSS live folders and queues sync.
 * Safe to call on every folder list — exits fast when already applied.
 */
export async function ensureStarterRssFoldersForUser(userId: string): Promise<void> {
  const profile = await db
    .select({ starterFeedsApplied: user.starterFeedsApplied })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!profile || profile.starterFeedsApplied) {
    return;
  }

  const newFolderIds: string[] = [];

  for (const starter of DEFAULT_SIGNUP_RSS_FEEDS) {
    const feedUrl = starter.feedUrl.trim();
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
      continue;
    }

    const folder = await createBookmarkFolderForUser(userId, {
      name: starter.name,
      sourceType: "rss",
      externalResourceId: feedUrl,
      syncEnabled: true,
    });
    newFolderIds.push(folder.id);
  }

  if (newFolderIds.length > 0) {
    const now = Date.now();
    await inngest.send(
      newFolderIds.map((folderId, index) => ({
        id: `rss-starter-sync-${folderId}-${now}-${index}`,
        name: "bookmark-folder/rss.sync.requested" as const,
        data: { folderId },
      })),
    );
  }

  await db.update(user).set({ starterFeedsApplied: true }).where(eq(user.id, userId));
}

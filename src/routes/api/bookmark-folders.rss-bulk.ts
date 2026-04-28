import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { bulkImportRssFeedFolders } from "@/lib/bookmarks/rss-bulk-import";

export const Route = createFileRoute("/api/bookmark-folders/rss-bulk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const payload = (await request.json()) as {
          feeds?: Array<{ name?: string; feedUrl?: string }>;
        };

        if (!Array.isArray(payload.feeds) || payload.feeds.length === 0) {
          return Response.json({ error: "Provide a non-empty `feeds` array." }, { status: 400 });
        }

        const items = payload.feeds
          .map((row) => ({
            name: (row.name ?? "").trim(),
            feedUrl: (row.feedUrl ?? "").trim(),
          }))
          .filter((row) => row.feedUrl.length > 0);

        if (items.length === 0) {
          return Response.json({ error: "No valid feed URLs in `feeds`." }, { status: 400 });
        }

        const result = await bulkImportRssFeedFolders(userId, items);
        return Response.json({ ...result, feedCount: items.length });
      },
    },
  },
});

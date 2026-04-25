import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { createBookmarkFolderForUser, listBookmarkFoldersForUser } from "@/lib/bookmarks/functions";

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

        const payload = (await request.json()) as { name?: string };
        const name = payload.name?.trim() ?? "";
        if (!name) {
          return Response.json({ error: "Folder name is required." }, { status: 400 });
        }

        const folder = await createBookmarkFolderForUser(userId, name);
        return Response.json(folder, { status: 201 });
      },
    },
  },
});

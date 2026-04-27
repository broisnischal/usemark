import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";

import { env } from "@/env/server";
import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { account, bookmark, bookmarkFolder, user, xConnection } from "@/lib/db/schema";

export const Route = createFileRoute("/api/profile")({
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

        const [accounts, xConnections, folders, publicBookmarks] = await Promise.all([
          db
            .select({
              id: account.id,
              providerId: account.providerId,
              accountId: account.accountId,
              scope: account.scope,
              createdAt: account.createdAt,
            })
            .from(account)
            .where(eq(account.userId, userId)),
          db
            .select({
              id: xConnection.id,
              username: xConnection.username,
              createdAt: xConnection.createdAt,
            })
            .from(xConnection)
            .where(eq(xConnection.userId, userId)),
          db
            .select({
              id: bookmarkFolder.id,
              name: bookmarkFolder.name,
              sourceType: bookmarkFolder.sourceType,
              visibility: bookmarkFolder.visibility,
              syncEnabled: bookmarkFolder.syncEnabled,
            })
            .from(bookmarkFolder)
            .where(eq(bookmarkFolder.userId, userId)),
          db
            .select({
              id: bookmark.id,
              title: bookmark.title,
              url: bookmark.url,
              tag: bookmark.tag,
              createdAt: bookmark.createdAt,
              folderName: bookmarkFolder.name,
            })
            .from(bookmark)
            .innerJoin(bookmarkFolder, eq(bookmark.folderId, bookmarkFolder.id))
            .where(and(eq(bookmark.userId, userId), eq(bookmark.visibility, "public")))
            .orderBy(desc(bookmark.createdAt))
            .limit(30),
        ]);
        const userPreferences = await db
          .select({
            utmEnabled: user.utmEnabled,
            utmSource: user.utmSource,
          })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1)
          .then((rows) => rows[0]);

        return Response.json({
          user: session.user,
          preferences: {
            utmEnabled: Boolean(userPreferences?.utmEnabled),
            utmSource: userPreferences?.utmSource?.trim() || "usemark",
          },
          connections: {
            accounts: accounts.map((item) => ({
              ...item,
              createdAt: item.createdAt.toISOString(),
            })),
            x: xConnections.map((item) => ({
              ...item,
              createdAt: item.createdAt.toISOString(),
            })),
          },
          sharedFolders: folders
            .filter((folder) => folder.visibility === "public")
            .map((folder) => ({
              ...folder,
              sourceType: folder.sourceType,
            })),
          publicBookmarks: publicBookmarks.map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            tag: item.tag,
            folderName: item.folderName,
            createdAt: item.createdAt.toISOString(),
          })),
          folderCount: folders.length,
          availableProviders: {
            github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
            google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
            x: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
          },
        });
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
          action?: string;
          utmEnabled?: boolean;
          utmSource?: string;
        };
        if (payload.action !== "update-utm-settings") {
          return Response.json({ error: "Unsupported action." }, { status: 400 });
        }

        const utmSource = payload.utmSource?.trim() || "usemark";
        await db
          .update(user)
          .set({
            utmEnabled: Boolean(payload.utmEnabled),
            utmSource,
          })
          .where(eq(user.id, userId));

        return Response.json({
          success: true,
          preferences: {
            utmEnabled: Boolean(payload.utmEnabled),
            utmSource,
          },
        });
      },
      DELETE: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
          query: {
            disableCookieCache: true,
          },
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        await db.delete(user).where(eq(user.id, userId));

        return Response.json({ success: true });
      },
    },
  },
});

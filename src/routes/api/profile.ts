import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

import { env } from "@/env/server";
import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { account, bookmarkFolder, user, xConnection } from "@/lib/db/schema";

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

        const [accounts, xConnections, folders] = await Promise.all([
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
        ]);

        return Response.json({
          user: session.user,
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
          folderCount: folders.length,
          availableProviders: {
            github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
            google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
            x: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
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

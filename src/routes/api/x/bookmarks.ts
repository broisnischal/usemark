import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { listXBookmarksForUser, XApiError } from "@/lib/bookmarks/x";

function getXErrorMessage(error: XApiError) {
  if (error.status === 401) {
    return "X authorization expired or is missing required scopes. Reconnect X.";
  }

  if (error.status === 403) {
    return "X rejected bookmark access. Check that your X app has bookmark.read scope and API access for bookmark lookup.";
  }

  if (error.status === 429) {
    return "X rate limit reached. Try again later.";
  }

  return "Could not fetch X bookmarks.";
}

export const Route = createFileRoute("/api/x/bookmarks")({
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

        try {
          const result = await listXBookmarksForUser(userId);
          return Response.json(result);
        } catch (error) {
          if (error instanceof XApiError) {
            return Response.json(
              {
                connected: true,
                bookmarks: [],
                error: getXErrorMessage(error),
                status: error.status,
                detail: error.detail,
              },
              { status: error.status },
            );
          }

          return Response.json(
            { connected: true, bookmarks: [], error: "Could not fetch X bookmarks." },
            { status: 500 },
          );
        }
      },
    },
  },
});

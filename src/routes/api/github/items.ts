import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { GitHubApiError, listGitHubItemsForUser } from "@/lib/bookmarks/github";

function getGitHubErrorMessage(error: GitHubApiError) {
  if (error.status === 401) {
    return "GitHub authorization expired or is missing required scopes. Reconnect GitHub.";
  }

  if (error.status === 403) {
    return "GitHub rejected this request. Reconnect GitHub with repo access, or check repository permissions.";
  }

  if (error.status === 404) {
    return "GitHub repository not found, or your account cannot access it.";
  }

  if (error.status === 429) {
    return "GitHub rate limit reached. Try again later.";
  }

  return "Could not fetch GitHub data.";
}

export const Route = createFileRoute("/api/github/items")({
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

        const url = new URL(request.url);
        const folderId = url.searchParams.get("folderId")?.trim() ?? "";
        if (!folderId) {
          return Response.json({ connected: true, items: [], error: "Folder id is required." }, { status: 400 });
        }

        try {
          const result = await listGitHubItemsForUser(userId, folderId);
          return Response.json(result);
        } catch (error) {
          if (error instanceof GitHubApiError) {
            return Response.json(
              {
                connected: true,
                items: [],
                error: getGitHubErrorMessage(error),
                status: error.status,
                detail: error.detail,
              },
              { status: error.status },
            );
          }

          return Response.json(
            { connected: true, items: [], error: "Could not fetch GitHub data." },
            { status: 500 },
          );
        }
      },
    },
  },
});

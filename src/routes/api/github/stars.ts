import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { GitHubApiError, listGitHubStarsForUser } from "@/lib/bookmarks/github";

function getGitHubErrorMessage(error: GitHubApiError) {
  if (error.status === 401) {
    return "GitHub authorization expired. Reconnect GitHub.";
  }
  if (error.status === 403) {
    return "GitHub rejected stars listing. Reconnect with repo permission.";
  }
  if (error.status === 429) {
    return "GitHub rate limit reached. Try again later.";
  }
  return "Could not fetch GitHub stars.";
}

export const Route = createFileRoute("/api/github/stars")({
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
        const limitParam = url.searchParams.get("limit");
        const parsedLimit = limitParam ? Number(limitParam) : null;
        const limit =
          typeof parsedLimit === "number" && Number.isFinite(parsedLimit) && parsedLimit > 0
            ? parsedLimit
            : 100;

        try {
          const result = await listGitHubStarsForUser(userId, limit);
          return Response.json(result);
        } catch (error) {
          if (error instanceof GitHubApiError) {
            return Response.json(
              {
                connected: true,
                stars: [],
                error: getGitHubErrorMessage(error),
                status: error.status,
                detail: error.detail,
              },
              { status: error.status },
            );
          }
          return Response.json(
            {
              connected: true,
              stars: [],
              error: "Could not fetch GitHub stars.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});

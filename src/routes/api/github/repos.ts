import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { GitHubApiError, listGitHubReposForUser } from "@/lib/bookmarks/github";

function getGitHubErrorMessage(error: GitHubApiError) {
  if (error.status === 401) {
    return "GitHub authorization expired. Reconnect GitHub.";
  }
  if (error.status === 403) {
    return "GitHub rejected repository listing. Reconnect with repo permission.";
  }
  if (error.status === 429) {
    return "GitHub rate limit reached. Try again later.";
  }
  return "Could not fetch GitHub repositories.";
}

export const Route = createFileRoute("/api/github/repos")({
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
          const result = await listGitHubReposForUser(userId);
          return Response.json(result);
        } catch (error) {
          if (error instanceof GitHubApiError) {
            return Response.json(
              {
                connected: true,
                hasRepoScope: false,
                repos: [],
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
              hasRepoScope: false,
              repos: [],
              error: "Could not fetch GitHub repositories.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});

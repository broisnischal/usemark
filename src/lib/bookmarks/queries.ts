import { queryOptions } from "@tanstack/react-query";

import type { BookmarkFolderRecord, BookmarkRecord } from "./functions";

export const bookmarksQueryKey = ["bookmarks"] as const;
export const bookmarkFoldersQueryKey = ["bookmark-folders"] as const;

async function readJson<T>(response: Response) {
  if (!response.ok) {
    const message = response.status === 401 ? "Please sign in." : "Request failed.";
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const bookmarksQueryOptions = () =>
  queryOptions({
    queryKey: bookmarksQueryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/bookmarks", {
        method: "GET",
        signal,
      });
      return readJson<BookmarkRecord[]>(response);
    },
  });

export const bookmarkSearchQueryOptions = (query: string) =>
  queryOptions({
    queryKey: ["bookmarks", "search", query] as const,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/bookmarks/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal,
      });
      return readJson<BookmarkRecord[]>(response);
    },
    enabled: Boolean(query.trim()),
  });

export const bookmarkFoldersQueryOptions = () =>
  queryOptions({
    queryKey: bookmarkFoldersQueryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "GET",
        signal,
      });
      return readJson<BookmarkFolderRecord[]>(response);
    },
  });

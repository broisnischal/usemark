import { queryOptions } from "@tanstack/react-query";

import type { BookmarkFolderRecord, BookmarkRecord } from "./functions";

export const bookmarksQueryKey = ["bookmarks"] as const;
export const bookmarkFoldersQueryKey = ["bookmark-folders"] as const;
export const xBookmarksQueryKey = ["x-bookmarks"] as const;
export const githubItemsQueryKey = ["github-items"] as const;

export interface XBookmarkRecord {
  id: string;
  url: string;
  title: string;
  authorName: string | null;
  username: string | null;
  createdAt: string | null;
}

export interface XBookmarksResponse {
  connected: boolean;
  bookmarks: XBookmarkRecord[];
  error?: string;
  status?: number;
  detail?: string;
}

export interface GitHubItemRecord {
  id: string;
  url: string;
  title: string;
  type: "all" | "issues" | "pulls" | "releases";
  state: string | null;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GitHubItemsResponse {
  connected: boolean;
  items: GitHubItemRecord[];
  error?: string;
  status?: number;
  detail?: string;
}

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
    staleTime: 15_000,
    gcTime: 5 * 60_000,
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
    staleTime: 20_000,
    gcTime: 5 * 60_000,
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
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "GET",
        signal,
      });
      return readJson<BookmarkFolderRecord[]>(response);
    },
  });

export const xBookmarksQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: xBookmarksQueryKey,
    enabled,
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/x/bookmarks", {
        method: "GET",
        signal,
      });
      const data = (await response.json()) as XBookmarksResponse;
      if (!response.ok && data.error) {
        return data;
      }
      return data;
    },
  });

export const githubItemsQueryOptions = (folderId: string | null | undefined) =>
  queryOptions({
    queryKey: [...githubItemsQueryKey, folderId ?? ""] as const,
    enabled: Boolean(folderId),
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/github/items?folderId=${encodeURIComponent(folderId ?? "")}`, {
        method: "GET",
        signal,
      });
      const data = (await response.json()) as GitHubItemsResponse;
      if (!response.ok && data.error) {
        return data;
      }
      return data;
    },
  });

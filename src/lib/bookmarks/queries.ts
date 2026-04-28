import { queryOptions } from "@tanstack/react-query";

import type { BookmarkFolderRecord, BookmarkRecord } from "./functions";

export const bookmarksQueryKey = ["bookmarks"] as const;
export const bookmarkFoldersQueryKey = ["bookmark-folders"] as const;
export const xBookmarksQueryKey = ["x-bookmarks"] as const;
export const githubItemsQueryKey = ["github-items"] as const;
export const githubReposQueryKey = ["github-repos"] as const;
export const githubStarsQueryKey = ["github-stars"] as const;

const FOLDER_DATA_STALE_TIME = 60_000;
const FOLDER_DATA_GC_TIME = 15 * 60_000;

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

export interface GitHubReposResponse {
  connected: boolean;
  hasRepoScope: boolean;
  repos: Array<{ id: number; fullName: string }>;
  error?: string;
  status?: number;
  detail?: string;
}

export interface GitHubStarsResponse {
  connected: boolean;
  stars: Array<{
    id: string;
    url: string;
    title: string;
    owner: string | null;
    createdAt: string | null;
  }>;
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

export const bookmarksQueryOptions = (
  folderId: string | null | undefined,
  enabled = true,
  limit?: number,
) =>
  queryOptions({
    queryKey: [...bookmarksQueryKey, "list", folderId ?? "all", limit ?? "all"] as const,
    enabled,
    staleTime: FOLDER_DATA_STALE_TIME,
    gcTime: FOLDER_DATA_GC_TIME,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (folderId) {
        params.set("folderId", folderId);
      }
      if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
        params.set("limit", String(Math.max(1, Math.floor(limit))));
      }
      const queryString = params.toString();
      const response = await fetch(`/api/bookmarks${queryString ? `?${queryString}` : ""}`, {
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
    staleTime: FOLDER_DATA_STALE_TIME,
    gcTime: FOLDER_DATA_GC_TIME,
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
    staleTime: FOLDER_DATA_STALE_TIME,
    gcTime: FOLDER_DATA_GC_TIME,
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
    staleTime: FOLDER_DATA_STALE_TIME,
    gcTime: FOLDER_DATA_GC_TIME,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/github/items?folderId=${encodeURIComponent(folderId ?? "")}`,
        {
          method: "GET",
          signal,
        },
      );
      const data = (await response.json()) as GitHubItemsResponse;
      if (!response.ok && data.error) {
        return data;
      }
      return data;
    },
  });

export const githubReposQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: githubReposQueryKey,
    enabled,
    retry: false,
    staleTime: FOLDER_DATA_STALE_TIME,
    gcTime: FOLDER_DATA_GC_TIME,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/github/repos", {
        method: "GET",
        signal,
      });
      const data = (await response.json()) as GitHubReposResponse;
      if (!response.ok && data.error) {
        return data;
      }
      return data;
    },
  });

export const githubStarsQueryOptions = (enabled: boolean, limit?: number) =>
  queryOptions({
    queryKey: [...githubStarsQueryKey, limit ?? "all"] as const,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
        params.set("limit", String(Math.max(1, Math.floor(limit))));
      }
      const queryString = params.toString();
      const response = await fetch(`/api/github/stars${queryString ? `?${queryString}` : ""}`, {
        method: "GET",
        signal,
      });
      const data = (await response.json()) as GitHubStarsResponse;
      if (!response.ok && data.error) {
        return data;
      }
      return data;
    },
  });

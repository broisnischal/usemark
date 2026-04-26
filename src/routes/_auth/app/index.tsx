import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  CheckSquareIcon,
  ClipboardIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  GitPullRequestIcon,
  Loader2Icon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { SiGithub, SiReddit, SiX } from "@icons-pack/react-simple-icons";
import * as React from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth-client";
import type {
  BookmarkContentType,
  BookmarkFolderRecord,
  BookmarkFolderSourceType,
  BookmarkRecord,
} from "@/lib/bookmarks/functions";
import {
  bookmarkFoldersQueryKey,
  bookmarkFoldersQueryOptions,
  bookmarkSearchQueryOptions,
  bookmarksQueryKey,
  bookmarksQueryOptions,
  githubItemsQueryKey,
  githubItemsQueryOptions,
  xBookmarksQueryKey,
  xBookmarksQueryOptions,
} from "@/lib/bookmarks/queries";

export const Route = createFileRoute("/_auth/app/")({
  component: AppIndex,
});

const BOOKMARK_INPUT_DEBOUNCE_MS = 300;
const ROW_PAGE_SIZE = 40;

type BookmarkSearchMode = "semantic" | "exact";
type GitHubResourceType = "all" | "issues" | "pulls" | "releases";

const LIVE_FOLDER_OPTIONS: Array<{
  sourceType: BookmarkFolderSourceType;
  name: string;
  description: string;
}> = [
  {
    sourceType: "rss",
    name: "RSS",
    description: "Watch a feed and save new entries.",
  },
  {
    sourceType: "github",
    name: "GitHub Issues",
    description: "Connect GitHub and follow assigned or saved issues.",
  },
  {
    sourceType: "x",
    name: "X Bookmarks",
    description: "Sync bookmarks from your X account.",
  },
  {
    sourceType: "reddit",
    name: "Reddit Saved",
    description: "Sync saved posts from your Reddit account.",
  },
];

function inferContentType(value: string): BookmarkContentType {
  const trimmed = value.trim();
  if (!trimmed) {
    return "text";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "link" : "text";
  } catch {
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed) ? "link" : "text";
  }
}

function normalizeBookmarkContent(value: string) {
  const trimmed = value.trim();
  const contentType = inferContentType(trimmed);

  if (contentType === "text") {
    return { content: trimmed, contentType };
  }

  try {
    return { content: new URL(trimmed).toString(), contentType };
  } catch {
    return { content: `https://${trimmed}`, contentType };
  }
}

function normalizeGitHubRepoInput(value: string) {
  const normalized = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "");
  const [owner, repo] = normalized.split("/").filter(Boolean);

  return owner && repo ? `${owner}/${repo}` : null;
}

function normalizeGitHubResourceTypeInput(value: string | undefined): GitHubResourceType {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "issue" || normalized === "issues") {
    return "issues";
  }
  if (normalized === "pr" || normalized === "prs" || normalized === "pull" || normalized === "pulls") {
    return "pulls";
  }
  if (normalized === "release" || normalized === "releases") {
    return "releases";
  }

  return "all";
}

function parseGitHubFolderCommand(value: string) {
  const match = value.trim().match(/^(?:gh|github)\s+(?:folder\s+)?(\S+)(?:\s+(\S+))?$/i);
  if (!match?.[1]) {
    return null;
  }

  const repo = normalizeGitHubRepoInput(match[1]);
  if (!repo) {
    return null;
  }

  return {
    repo,
    resourceType: normalizeGitHubResourceTypeInput(match[2]),
  };
}

function getHostFromUrlValue(urlValue: string) {
  try {
    return new URL(urlValue).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getDisplayLabelFromUrlValue(urlValue: string) {
  try {
    const parsed = new URL(urlValue);
    const host = parsed.hostname.replace(/^www\./, "");
    const lastPathSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (lastPathSegment) {
      return decodeURIComponent(lastPathSegment).replace(/[-_]+/g, " ");
    }
    return host;
  } catch {
    return urlValue;
  }
}

function bookmarkMatchesSearch(row: BookmarkRecord, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    row.title ?? "",
    row.url,
    row.tag,
    row.folderName,
    row.embeddingStatus,
    getHostFromUrlValue(row.url),
    getDisplayLabelFromUrlValue(row.url),
  ]
    .join(" ")
    .toLowerCase();

  return normalizedQuery
    .split(/\s+/g)
    .every((token) => token.length === 0 || searchableText.includes(token));
}

function removeBookmarkRow(rows: BookmarkRecord[] | undefined, bookmarkId: string) {
  if (!rows) {
    return rows;
  }

  return rows.filter((row) => row.id !== bookmarkId);
}

function getFolderSourceLabel(sourceType: BookmarkFolderSourceType) {
  if (sourceType === "github") {
    return "GitHub";
  }
  if (sourceType === "x") {
    return "X";
  }
  if (sourceType === "reddit") {
    return "Reddit";
  }
  if (sourceType === "rss") {
    return "RSS";
  }

  return "Folder";
}

function FolderSourceIcon({ sourceType }: { sourceType: BookmarkFolderSourceType }) {
  if (sourceType === "github") {
    return <SiGithub className="size-3.5" />;
  }
  if (sourceType === "x") {
    return <SiX className="size-3.5" />;
  }
  if (sourceType === "reddit") {
    return <SiReddit className="size-3.5" />;
  }
  if (sourceType === "rss") {
    return <RssIcon className="size-3.5" />;
  }

  return <FolderIcon className="size-3.5" />;
}

function useDebouncedValue<TValue>(value: TValue, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function AppIndex() {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = React.useState("");
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null | undefined>(undefined);
  const [addFolderId, setAddFolderId] = React.useState<string | null>(null);
  const [searchMode, setSearchMode] = React.useState<BookmarkSearchMode>("semantic");
  const [isRssFolderDialogOpen, setIsRssFolderDialogOpen] = React.useState(false);
  const [isGitHubFolderDialogOpen, setIsGitHubFolderDialogOpen] = React.useState(false);
  const [isCustomFolderDialogOpen, setIsCustomFolderDialogOpen] = React.useState(false);
  const [renamingBookmark, setRenamingBookmark] = React.useState<BookmarkRecord | null>(null);
  const [rssFeedUrl, setRssFeedUrl] = React.useState("");
  const [githubRepoValue, setGithubRepoValue] = React.useState("");
  const [githubResourceType, setGithubResourceType] = React.useState<GitHubResourceType>("all");
  const [customFolderName, setCustomFolderName] = React.useState("");
  const [bookmarkTitleValue, setBookmarkTitleValue] = React.useState("");
  const [rowPagination, setRowPagination] = React.useState({
    scope: "",
    limit: ROW_PAGE_SIZE,
  });
  const loadMoreRef = React.useRef<HTMLLIElement | null>(null);
  const debouncedInputValue = useDebouncedValue(inputValue, BOOKMARK_INPUT_DEBOUNCE_MS);
  const search = inputValue.trim() ? debouncedInputValue.trim() : "";

  const bookmarksQuery = useQuery(bookmarksQueryOptions());
  const foldersQuery = useQuery(bookmarkFoldersQueryOptions());
  const searchQuery = useQuery({
    ...bookmarkSearchQueryOptions(search),
    enabled: searchMode === "semantic" && Boolean(search.trim()),
    placeholderData: (previousData) => previousData,
  });
  const xBookmarksQuery = useQuery(
    xBookmarksQueryOptions(Boolean(foldersQuery.data?.some((folder) => folder.sourceType === "x"))),
  );
  const queryPinnedFolder = foldersQuery.data?.find((folder) => folder.isPinned) ?? null;
  const queryActiveFolderId = selectedFolderId === undefined ? queryPinnedFolder?.id ?? null : selectedFolderId;
  const queryActiveFolder = foldersQuery.data?.find((folder) => folder.id === queryActiveFolderId) ?? null;
  const githubItemsQuery = useQuery(
    githubItemsQueryOptions(queryActiveFolder?.sourceType === "github" ? queryActiveFolder.id : null),
  );

  const getTagFromUrl = React.useCallback((urlValue: string) => {
    const normalizedContent = normalizeBookmarkContent(urlValue);
    if (normalizedContent.contentType === "text") {
      return "text";
    }

    try {
      const host = new URL(normalizedContent.content).hostname.replace(/^www\./, "").toLowerCase();
      return host.split(".")[0] ?? "other";
    } catch {
      return "other";
    }
  }, []);

  const getHostFromUrl = React.useCallback((urlValue: string) => {
    return getHostFromUrlValue(urlValue);
  }, []);

  const getDisplayLabelFromUrl = React.useCallback((urlValue: string) => {
    return getDisplayLabelFromUrlValue(urlValue);
  }, []);

  const createBookmarkMutation = useMutation({
    mutationFn: async (payload: { url: string; folder: string; folderId?: string }) => {
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = response.status === 401 ? "Please sign in." : "Could not save bookmark.";
        throw new Error(message);
      }

      return (await response.json()) as { id: string; embeddingStatus: string };
    },
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);

      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const normalizedContent = normalizeBookmarkContent(payload.url);
      const optimisticRow: BookmarkRecord = {
        id: optimisticId,
        contentType: normalizedContent.contentType,
        url: normalizedContent.content,
        title:
          normalizedContent.contentType === "text"
            ? normalizedContent.content.slice(0, 80)
            : null,
        tag: getTagFromUrl(payload.url),
        folderId: payload.folderId ?? optimisticId,
        folderName: payload.folder || "default",
        embeddingStatus: "pending",
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData(bookmarksQueryKey, (currentRows: BookmarkRecord[] | undefined) => [
        optimisticRow,
        ...(currentRows ?? []),
      ]);
      queryClient
        .getQueriesData<BookmarkRecord[]>({ queryKey: ["bookmarks", "search"] })
        .forEach(([queryKey, currentRows]) => {
          if (!currentRows) {
            return;
          }

          const cachedSearch = typeof queryKey[2] === "string" ? queryKey[2] : "";
          if (!bookmarkMatchesSearch(optimisticRow, cachedSearch)) {
            return;
          }

          queryClient.setQueryData(queryKey, [optimisticRow, ...currentRows]);
        });

      return { optimisticId };
    },
    onSuccess: async (result, __, context) => {
      if (context?.optimisticId) {
        const replaceOptimisticRow = (currentRows: BookmarkRecord[] | undefined) => {
          if (!currentRows) {
            return currentRows;
          }

          return currentRows.map((item) =>
            item.id === context.optimisticId
              ? {
                  ...item,
                  id: result.id,
                  embeddingStatus: result.embeddingStatus,
                }
              : item,
          );
        };

        queryClient.setQueryData(bookmarksQueryKey, replaceOptimisticRow);
        queryClient.setQueriesData({ queryKey: ["bookmarks", "search"] }, replaceOptimisticRow);
      }
      toast.success("Bookmark saved. Embedding is processing in background.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
    onError: (error, _variables, context) => {
      if (context?.optimisticId) {
        const removeOptimisticRow = (currentRows: BookmarkRecord[] | undefined) => {
          if (!currentRows) {
            return currentRows;
          }

          return currentRows.filter((item) => item.id !== context.optimisticId);
        };

        queryClient.setQueryData(bookmarksQueryKey, removeOptimisticRow);
        queryClient.setQueriesData({ queryKey: ["bookmarks", "search"] }, removeOptimisticRow);
      }
      const message = error instanceof Error ? error.message : "Could not save bookmark.";
      toast.error(message);
    },
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: async (bookmarkId: string) => {
      const response = await fetch("/api/bookmarks", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: bookmarkId }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, id: bookmarkId };
        }

        const message =
          response.status === 401 ? "Please sign in." : "Could not delete bookmark.";
        throw new Error(message);
      }

      return (await response.json()) as { success: true; id: string };
    },
    onMutate: async (bookmarkId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);

      const previousBookmarks = queryClient.getQueryData<BookmarkRecord[]>(bookmarksQueryKey);
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });

      queryClient.setQueryData(bookmarksQueryKey, (currentRows: BookmarkRecord[] | undefined) =>
        removeBookmarkRow(currentRows, bookmarkId),
      );
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (currentRows: BookmarkRecord[] | undefined) =>
          removeBookmarkRow(currentRows, bookmarkId),
        );
      });

      return { previousBookmarks, previousSearches };
    },
    onSuccess: () => {
      toast.success("Bookmark deleted.");
    },
    onError: (error, _bookmarkId, context) => {
      queryClient.setQueryData(bookmarksQueryKey, context?.previousBookmarks);
      context?.previousSearches.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });

      const message = error instanceof Error ? error.message : "Could not delete bookmark.";
      toast.error(message);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
  });

  const renameBookmarkMutation = useMutation({
    mutationFn: async (payload: { id: string; title: string }) => {
      const response = await fetch("/api/bookmarks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          response.status === 401
            ? "Please sign in."
            : errorBody?.error || "Could not rename bookmark.",
        );
      }

      return (await response.json()) as { success: true; id: string; title: string };
    },
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);

      const previousBookmarks = queryClient.getQueryData<BookmarkRecord[]>(bookmarksQueryKey);
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });
      const renameRow = (currentRows: BookmarkRecord[] | undefined) =>
        currentRows?.map((row) =>
          row.id === payload.id ? { ...row, title: payload.title } : row,
        );

      queryClient.setQueryData(bookmarksQueryKey, renameRow);
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, renameRow);
      });

      return { previousBookmarks, previousSearches };
    },
    onSuccess: () => {
      toast.success("Bookmark title updated.");
      setRenamingBookmark(null);
      setBookmarkTitleValue("");
    },
    onError: (error, _payload, context) => {
      queryClient.setQueryData(bookmarksQueryKey, context?.previousBookmarks);
      context?.previousSearches.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      const message = error instanceof Error ? error.message : "Could not rename bookmark.";
      toast.error(message);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
  });

  const refetchBookmarkMetadataMutation = useMutation({
    mutationFn: async (bookmarkId: string) => {
      const response = await fetch("/api/bookmarks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: bookmarkId, action: "refetch-metadata" }),
      });

      if (!response.ok) {
        throw new Error(response.status === 401 ? "Please sign in." : "Could not refetch metadata.");
      }
    },
    onSuccess: async () => {
      toast.success("Metadata refreshed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not refetch metadata.";
      toast.error(message);
    },
  });

  const connectGitHubMutation = useMutation({
    mutationFn: async () =>
      await authClient.linkSocial(
        {
          provider: "github",
          scopes: ["repo", "read:org", "user:email"],
          callbackURL: "/app",
        },
        {
          onError: ({ error }) => {
            toast.error(error.message || "Could not connect GitHub.");
          },
        },
      ),
  });

  const createLiveFolderMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      sourceType: BookmarkFolderSourceType;
      externalResourceId?: string | null;
    }) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: payload.name,
          sourceType: payload.sourceType,
          syncEnabled: payload.sourceType !== "local",
          externalResourceId: payload.externalResourceId ?? null,
        }),
      });

      if (!response.ok) {
        const message =
          response.status === 401 ? "Please sign in." : "Could not create live folder.";
        throw new Error(message);
      }

      return (await response.json()) as BookmarkFolderRecord;
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: bookmarkFoldersQueryKey });

      const previousFolders = queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);
      const optimisticFolder: BookmarkFolderRecord = {
        id: `optimistic-folder-${crypto.randomUUID()}`,
        name: payload.name.toLowerCase(),
        sourceType: payload.sourceType,
        syncEnabled: payload.sourceType !== "local",
        externalAccountId: null,
        externalResourceId: payload.externalResourceId ?? null,
        lastSyncedAt: null,
        unseenCount: 0,
        isPinned: false,
        visibility: "private",
      };

      queryClient.setQueryData(bookmarkFoldersQueryKey, (currentFolders: BookmarkFolderRecord[] | undefined) => [
        ...(currentFolders ?? []),
        optimisticFolder,
      ]);

      return { previousFolders };
    },
    onSuccess: (folder) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, (currentFolders: BookmarkFolderRecord[] | undefined) => {
        if (!currentFolders) {
          return [folder];
        }

        return currentFolders.map((item) =>
          item.name === folder.name && item.sourceType === folder.sourceType ? folder : item,
        );
      });
      toast.success(
        folder.sourceType === "local"
          ? "Folder created."
          : `${getFolderSourceLabel(folder.sourceType)} folder added.`,
      );
      setIsRssFolderDialogOpen(false);
      setIsGitHubFolderDialogOpen(false);
      setIsCustomFolderDialogOpen(false);
      setRssFeedUrl("");
      setGithubRepoValue("");
      setGithubResourceType("all");
      setCustomFolderName("");
      if (folder.sourceType === "local") {
        setAddFolderId(folder.id);
      }
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      const message = error instanceof Error ? error.message : "Could not create live folder.";
      toast.error(message);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey });
    },
  });

  const markFolderSeenMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: folderId, action: "mark-seen" }),
      });

      if (!response.ok) {
        throw new Error("Could not mark folder as seen.");
      }
    },
    onMutate: async (folderId) => {
      await queryClient.cancelQueries({ queryKey: bookmarkFoldersQueryKey });
      const previousFolders = queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);

      queryClient.setQueryData(bookmarkFoldersQueryKey, (currentFolders: BookmarkFolderRecord[] | undefined) =>
        currentFolders?.map((folder) =>
          folder.id === folderId ? { ...folder, unseenCount: 0 } : folder,
        ),
      );

      return { previousFolders };
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      const message = error instanceof Error ? error.message : "Could not mark folder as seen.";
      toast.error(message);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
  });

  const pinFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: folderId, action: "pin" }),
      });

      if (!response.ok) {
        throw new Error(response.status === 401 ? "Please sign in." : "Could not pin folder.");
      }
    },
    onMutate: async (folderId) => {
      await queryClient.cancelQueries({ queryKey: bookmarkFoldersQueryKey });
      const previousFolders = queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);

      queryClient.setQueryData(bookmarkFoldersQueryKey, (currentFolders: BookmarkFolderRecord[] | undefined) =>
        currentFolders
          ?.map((folder) => ({ ...folder, isPinned: folder.id === folderId }))
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.name.localeCompare(b.name)),
      );
      setSelectedFolderId(folderId);

      return { previousFolders };
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      const message = error instanceof Error ? error.message : "Could not pin folder.";
      toast.error(message);
    },
  });

  const syncFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: folderId, action: "sync" }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          response.status === 401
            ? "Please sign in."
            : errorBody?.error || "Could not sync folder.",
        );
      }

      return (await response.json()) as {
        success: true;
        id: string;
        sourceType: BookmarkFolderSourceType;
      };
    },
    onMutate: async (folderId) => {
      await queryClient.cancelQueries({ queryKey: bookmarkFoldersQueryKey });
      const previousFolders = queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);

      queryClient.setQueryData(bookmarkFoldersQueryKey, (currentFolders: BookmarkFolderRecord[] | undefined) =>
        currentFolders?.map((folder) =>
          folder.id === folderId ? { ...folder, lastSyncedAt: new Date().toISOString() } : folder,
        ),
      );

      return { previousFolders };
    },
    onSuccess: async (result) => {
      toast.success(result.sourceType === "rss" ? "RSS sync started." : "Folder refreshed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
        result.sourceType === "rss"
          ? queryClient.invalidateQueries({ queryKey: bookmarksQueryKey })
          : Promise.resolve(),
        result.sourceType === "rss"
          ? queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] })
          : Promise.resolve(),
        result.sourceType === "x"
          ? queryClient.invalidateQueries({ queryKey: xBookmarksQueryKey })
          : Promise.resolve(),
        result.sourceType === "github"
          ? queryClient.invalidateQueries({ queryKey: githubItemsQueryKey })
          : Promise.resolve(),
      ]);
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      const message = error instanceof Error ? error.message : "Could not sync folder.";
      toast.error(message);
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: folderId }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, id: folderId };
        }

        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        const message =
          response.status === 401
            ? "Please sign in."
            : errorBody?.error || "Could not delete folder.";
        throw new Error(message);
      }

      return (await response.json()) as { success: true; id: string };
    },
    onMutate: async (folderId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarkFoldersQueryKey }),
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);

      const previousFolders = queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);
      const previousBookmarks = queryClient.getQueryData<BookmarkRecord[]>(bookmarksQueryKey);
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });

      queryClient.setQueryData(bookmarkFoldersQueryKey, (currentFolders: BookmarkFolderRecord[] | undefined) =>
        currentFolders?.filter((folder) => folder.id !== folderId),
      );
      queryClient.setQueryData(bookmarksQueryKey, (currentRows: BookmarkRecord[] | undefined) =>
        currentRows?.filter((row) => row.folderId !== folderId),
      );
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (currentRows: BookmarkRecord[] | undefined) =>
          currentRows?.filter((row) => row.folderId !== folderId),
        );
      });
      setSelectedFolderId((currentFolderId) => (currentFolderId === folderId ? null : currentFolderId));

      return { previousFolders, previousBookmarks, previousSearches };
    },
    onSuccess: () => {
      toast.success("Folder deleted.");
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      queryClient.setQueryData(bookmarksQueryKey, context?.previousBookmarks);
      context?.previousSearches.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });

      const message = error instanceof Error ? error.message : "Could not delete folder.";
      toast.error(message);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
  });

  const submitBookmark = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = inputValue.trim();
    if (!nextUrl) {
      return;
    }

    const githubFolderCommand = parseGitHubFolderCommand(nextUrl);
    if (githubFolderCommand) {
      setInputValue("");
      createLiveFolderMutation.mutate({
        name: githubFolderCommand.resourceType,
        sourceType: "github",
        externalResourceId: githubFolderCommand.repo,
      });
      return;
    }

    setInputValue("");
    createBookmarkMutation.mutate({
      url: nextUrl,
      folder: addFolder?.name ?? "default",
      folderId: addFolder?.id,
    });
  };

  const submitRssFolder = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const feedUrl = rssFeedUrl.trim();
    if (!feedUrl) {
      return;
    }

    createLiveFolderMutation.mutate({
      name: "",
      sourceType: "rss",
      externalResourceId: feedUrl,
    });
  };

  const submitGitHubFolder = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repo = githubRepoValue.trim();
    if (!repo) {
      return;
    }

    createLiveFolderMutation.mutate({
      name: githubResourceType,
      sourceType: "github",
      externalResourceId: repo,
    });
  };

  const submitCustomFolder = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = customFolderName.trim();
    if (!name) {
      return;
    }

    createLiveFolderMutation.mutate({
      name,
      sourceType: "local",
      externalResourceId: null,
    });
  };

  const submitBookmarkTitle = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = bookmarkTitleValue.trim();
    if (!renamingBookmark || !title) {
      return;
    }

    renameBookmarkMutation.mutate({ id: renamingBookmark.id, title });
  };

  const allRows = bookmarksQuery.data ?? [];
  const fetchedRows: BookmarkRecord[] = search.trim()
    ? searchMode === "semantic"
      ? (searchQuery.data ?? [])
      : allRows.filter((row) => bookmarkMatchesSearch(row, search))
    : allRows;
  const folders = foldersQuery.data ?? [];
  const manualFolders = folders.filter((folder) => folder.sourceType === "local");
  const pinnedFolder = folders.find((folder) => folder.isPinned) ?? null;
  const activeFolderId = selectedFolderId === undefined ? pinnedFolder?.id ?? null : selectedFolderId;
  const selectedFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const isXFolderSelected = selectedFolder?.sourceType === "x";
  const isGitHubFolderSelected = selectedFolder?.sourceType === "github";
  const defaultFolder = manualFolders.find((folder) => folder.name === "default") ?? null;
  const addFolder =
    manualFolders.find((folder) => folder.id === addFolderId) ??
    (selectedFolder?.sourceType === "local" ? selectedFolder : null) ??
    defaultFolder ??
    manualFolders[0] ??
    null;
  const visibleRows = isXFolderSelected || isGitHubFolderSelected
    ? []
    : activeFolderId
      ? fetchedRows.filter((row) => row.folderId === activeFolderId)
      : fetchedRows;
  const xRows = (xBookmarksQuery.data?.bookmarks ?? []).filter((row) => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!isXFolderSelected || !normalizedSearch) {
      return true;
    }

    return [row.title, row.authorName ?? "", row.username ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const githubRows = (githubItemsQuery.data?.items ?? []).filter((row) => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!isGitHubFolderSelected || !normalizedSearch) {
      return true;
    }

    return [row.title, row.author ?? "", row.state ?? "", row.type]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const liveFolderSourceTypes = new Set(
    folders.filter((folder) => folder.sourceType !== "local").map((folder) => folder.sourceType),
  );
  const isLoadingRows =
    isXFolderSelected
      ? xBookmarksQuery.isLoading
      : isGitHubFolderSelected
        ? githubItemsQuery.isLoading
        : search.trim() && searchMode === "semantic" ? searchQuery.isLoading : bookmarksQuery.isLoading;
  const isRefreshingRows =
    isXFolderSelected
      ? xBookmarksQuery.isFetching
      : isGitHubFolderSelected
        ? githubItemsQuery.isFetching
        : search.trim() && searchMode === "semantic" ? searchQuery.isFetching : bookmarksQuery.isFetching;
  const rowPaginationScope = [
    isXFolderSelected ? "x" : isGitHubFolderSelected ? "github" : "bookmarks",
    activeFolderId ?? "all",
    searchMode,
    search,
  ].join(":");
  const visibleRowLimit =
    rowPagination.scope === rowPaginationScope ? rowPagination.limit : ROW_PAGE_SIZE;
  const totalVisibleRows = isXFolderSelected
    ? xRows.length
    : isGitHubFolderSelected
      ? githubRows.length
      : visibleRows.length;
  const hasMoreRows = totalVisibleRows > visibleRowLimit;
  const displayedXRows = xRows.slice(0, visibleRowLimit);
  const displayedGitHubRows = githubRows.slice(0, visibleRowLimit);
  const displayedVisibleRows = visibleRows.slice(0, visibleRowLimit);

  React.useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreRows || isLoadingRows) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRowPagination((currentPagination) => {
            const currentLimit =
              currentPagination.scope === rowPaginationScope ? currentPagination.limit : ROW_PAGE_SIZE;

            return {
              scope: rowPaginationScope,
              limit: Math.min(currentLimit + ROW_PAGE_SIZE, totalVisibleRows),
            };
          });
        }
      },
      { rootMargin: "160px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreRows, isLoadingRows, rowPaginationScope, totalVisibleRows]);

  const copyBookmarkUrl = React.useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Bookmark URL copied.");
    } catch {
      toast.error("Could not copy bookmark URL.");
    }
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mx-auto w-full">
        <form className="mb-5" onSubmit={submitBookmark}>
          <div className="flex min-h-11 items-center rounded-lg border bg-card/90 shadow-sm shadow-foreground/5 transition-all duration-150 focus-within:border-ring/50 focus-within:ring-3 focus-within:ring-ring/10">
            <DropdownMenu>
              <DropdownMenuTrigger
                type="button"
                className="ml-1 inline-flex h-9 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
              >
                <FolderIcon className="size-3.5" />
                <span className="truncate">{addFolder?.name ?? "default"}</span>
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 rounded-lg p-1" align="start">
                {manualFolders.length > 0 ? (
                  manualFolders.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      className="gap-2"
                      onClick={() => setAddFolderId(folder.id)}
                    >
                      <FolderIcon className="size-3.5" />
                      <span className="truncate">{folder.name}</span>
                      {addFolder?.id === folder.id ? (
                        <CheckSquareIcon className="ml-auto size-3.5 text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => setIsCustomFolderDialogOpen(true)}
                >
                  <PlusIcon className="size-3.5" />
                  New folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
              placeholder={
                searchMode === "semantic"
                  ? "Add a bookmark, or search semantically..."
                  : "Add a bookmark, or search exact text..."
              }
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              required
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                type="button"
                className="mr-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {searchMode === "semantic" ? (
                  <SparklesIcon className="size-3.5" />
                ) : (
                  <SearchIcon className="size-3.5" />
                )}
                <span className="hidden sm:inline">
                  {searchMode === "semantic" ? "semantic" : "exact"}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52 rounded-lg p-1" align="end">
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => setSearchMode("semantic")}
                >
                  <SparklesIcon className="size-3.5" />
                  <span>Semantic search</span>
                  {searchMode === "semantic" ? (
                    <CheckSquareIcon className="ml-auto size-3.5 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => setSearchMode("exact")}
                >
                  <SearchIcon className="size-3.5" />
                  <span>Exact search</span>
                  {searchMode === "exact" ? (
                    <CheckSquareIcon className="ml-auto size-3.5 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="mr-2 hidden shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
              {createBookmarkMutation.isPending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <CornerDownLeftIcon className="size-3.5" />
              )}
              {createBookmarkMutation.isPending ? "saving" : "add"}
            </span>
          </div>
        </form>

        <div className="my-4 flex flex-wrap items-center gap-2">
          {foldersQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`folder-skeleton-${index}`}
                className="h-8 w-24 animate-pulse rounded-md border bg-muted/50"
              />
            ))
          ) : null}

          {!foldersQuery.isLoading ? (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-foreground shadow-sm shadow-foreground/5 transition-all hover:-translate-y-px hover:bg-muted/60 aria-pressed:bg-muted"
              aria-pressed={!activeFolderId}
              onClick={() => setSelectedFolderId(null)}
            >
              <FolderIcon className="size-3.5 text-muted-foreground" />
              All
            </button>
          ) : null}

          {!foldersQuery.isLoading &&
            folders.map((folder) => (
              <ContextMenu key={folder.id}>
                <ContextMenuTrigger className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                  <button
                    type="button"
                    className="inline-flex h-8 max-w-48 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-foreground shadow-sm shadow-foreground/5 transition-all hover:-translate-y-px hover:bg-muted/60 aria-pressed:bg-muted data-[state=open]:bg-muted"
                    aria-pressed={activeFolderId === folder.id}
                    onClick={() => {
                      setSelectedFolderId(folder.id);
                      if (folder.unseenCount > 0) {
                        markFolderSeenMutation.mutate(folder.id);
                      }
                    }}
                    title={folder.sourceType === "local" ? folder.name : `${getFolderSourceLabel(folder.sourceType)} live folder`}
                  >
                    <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                      <FolderSourceIcon sourceType={folder.sourceType} />
                    </span>
                    <span className="truncate">{folder.name}</span>
                    {folder.isPinned ? (
                      <PinIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
                    ) : null}
                    {folder.syncEnabled ? (
                      <span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                    ) : null}
                    {folder.unseenCount > 0 ? (
                      <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                        {folder.unseenCount}
                      </span>
                    ) : null}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-44 rounded-lg p-1">
                  <ContextMenuItem
                    disabled={folder.isPinned || pinFolderMutation.isPending}
                    onClick={() => pinFolderMutation.mutate(folder.id)}
                  >
                    {pinFolderMutation.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <PinIcon />
                    )}
                    {folder.isPinned ? "Pinned" : "Pin folder"}
                  </ContextMenuItem>
                  {folder.sourceType !== "local" ? (
                    <ContextMenuItem
                      disabled={syncFolderMutation.isPending}
                      onClick={() => syncFolderMutation.mutate(folder.id)}
                    >
                      {syncFolderMutation.isPending ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <RefreshCwIcon />
                      )}
                      Sync now
                    </ContextMenuItem>
                  ) : null}
                  <ContextMenuItem
                    disabled={folder.unseenCount === 0}
                    onClick={() => markFolderSeenMutation.mutate(folder.id)}
                  >
                    <CheckSquareIcon />
                    Mark as seen
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={folder.name === "default" || deleteFolderMutation.isPending}
                    variant="destructive"
                    onClick={() => deleteFolderMutation.mutate(folder.id)}
                  >
                    {deleteFolderMutation.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon />
                    )}
                    Delete folder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed bg-background px-2.5 text-sm text-muted-foreground shadow-sm shadow-foreground/5 transition-all hover:-translate-y-px hover:bg-muted/60 hover:text-foreground">
              <PlusIcon className="size-3.5" />
              Live folder
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72 rounded-lg p-1" align="start">
              {LIVE_FOLDER_OPTIONS.map((option) => {
                const alreadyAdded =
                  option.sourceType !== "rss" &&
                  option.sourceType !== "github" &&
                  liveFolderSourceTypes.has(option.sourceType);

                return (
                  <DropdownMenuItem
                    key={option.sourceType}
                    disabled={alreadyAdded || createLiveFolderMutation.isPending}
                    className="items-start gap-3 py-2.5"
                    onClick={() => {
                      if (option.sourceType === "rss") {
                        setIsRssFolderDialogOpen(true);
                        return;
                      }

                      if (option.sourceType === "github") {
                        setIsGitHubFolderDialogOpen(true);
                        return;
                      }

                      if (option.sourceType === "x") {
                        window.location.href = "/api/x/connect";
                        return;
                      }

                      toast.info(`${option.name} connection setup is coming next.`);
                    }}
                  >
                    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                      <FolderSourceIcon sourceType={option.sourceType} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">
                        {alreadyAdded ? `${option.name} added` : option.name}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="items-start gap-3 py-2.5"
                disabled={createLiveFolderMutation.isPending}
                onClick={() => setIsCustomFolderDialogOpen(true)}
              >
                <FolderIcon className="mt-0.5 size-4" />
                <span>
                  <span className="block text-sm text-foreground">Custom folder</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Create a manual folder for saved bookmarks.
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog
            open={isRssFolderDialogOpen}
            onOpenChange={(open) => {
              setIsRssFolderDialogOpen(open);
              if (!open) {
                setRssFeedUrl("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add RSS live folder</DialogTitle>
                <DialogDescription>
                  Paste an RSS or Atom feed URL. The folder name is read from the feed channel and new items sync automatically.
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-4" onSubmit={submitRssFolder}>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="rss-feed-url">
                    Feed URL
                  </label>
                  <Input
                    id="rss-feed-url"
                    className="h-9 rounded-md text-sm"
                    placeholder="https://example.com/feed.xml"
                    value={rssFeedUrl}
                    onChange={(event) => setRssFeedUrl(event.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Multiple RSS folders are allowed. Each feed is tracked separately.
                  </p>
                </div>
                <DialogFooter>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setIsRssFolderDialogOpen(false);
                      setRssFeedUrl("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={createLiveFolderMutation.isPending}
                  >
                    {createLiveFolderMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : null}
                    {createLiveFolderMutation.isPending ? "Adding" : "Add live folder"}
                  </button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isGitHubFolderDialogOpen}
            onOpenChange={(open) => {
              setIsGitHubFolderDialogOpen(open);
              if (!open) {
                setGithubRepoValue("");
                setGithubResourceType("all");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add GitHub live folder</DialogTitle>
                <DialogDescription>
                  Connect GitHub, then choose a repository stream. Issues, PRs, and releases are fetched live.
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-4" onSubmit={submitGitHubFolder}>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="github-repo">
                    Repository
                  </label>
                  <Input
                    id="github-repo"
                    className="h-9 rounded-md text-sm"
                    placeholder="owner/repo"
                    value={githubRepoValue}
                    onChange={(event) => setGithubRepoValue(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-foreground">Stream</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["all", "issues", "pulls", "releases"] as const).map((resourceType) => (
                      <button
                        key={resourceType}
                        type="button"
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm capitalize text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:border-ring aria-pressed:bg-muted aria-pressed:text-foreground"
                        aria-pressed={githubResourceType === resourceType}
                        onClick={() => setGithubResourceType(resourceType)}
                      >
                        {resourceType === "pulls" ? (
                          <GitPullRequestIcon className="size-3.5" />
                        ) : (
                          <SiGithub className="size-3.5" />
                        )}
                        {resourceType}
                      </button>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
                    disabled={connectGitHubMutation.isPending}
                    onClick={() => connectGitHubMutation.mutate()}
                  >
                    {connectGitHubMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <SiGithub className="size-3.5" />
                    )}
                    Connect GitHub
                  </button>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={createLiveFolderMutation.isPending}
                  >
                    {createLiveFolderMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : null}
                    {createLiveFolderMutation.isPending ? "Adding" : "Add live folder"}
                  </button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isCustomFolderDialogOpen}
            onOpenChange={(open) => {
              setIsCustomFolderDialogOpen(open);
              if (!open) {
                setCustomFolderName("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create folder</DialogTitle>
                <DialogDescription>
                  Manual folders can be selected from the input and used when saving new bookmarks.
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-4" onSubmit={submitCustomFolder}>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="custom-folder-name">
                    Folder name
                  </label>
                  <Input
                    id="custom-folder-name"
                    className="h-9 rounded-md text-sm"
                    placeholder="reading list"
                    value={customFolderName}
                    onChange={(event) => setCustomFolderName(event.target.value)}
                    required
                  />
                </div>
                <DialogFooter>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setIsCustomFolderDialogOpen(false);
                      setCustomFolderName("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={createLiveFolderMutation.isPending}
                  >
                    {createLiveFolderMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : null}
                    {createLiveFolderMutation.isPending ? "Creating" : "Create folder"}
                  </button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(renamingBookmark)}
            onOpenChange={(open) => {
              if (!open) {
                setRenamingBookmark(null);
                setBookmarkTitleValue("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename bookmark</DialogTitle>
                <DialogDescription>
                  This title is used in the list, exact search, and future semantic indexing.
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-4" onSubmit={submitBookmarkTitle}>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="bookmark-title">
                    Title
                  </label>
                  <Input
                    id="bookmark-title"
                    className="h-9 rounded-md text-sm"
                    value={bookmarkTitleValue}
                    onChange={(event) => setBookmarkTitleValue(event.target.value)}
                    required
                  />
                </div>
                <DialogFooter>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setRenamingBookmark(null);
                      setBookmarkTitleValue("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={renameBookmarkMutation.isPending}
                  >
                    {renameBookmarkMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : null}
                    {renameBookmarkMutation.isPending ? "Saving" : "Save title"}
                  </button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="grid grid-cols-[minmax(0,1fr)_86px] border-b pb-2 text-sm text-muted-foreground">
          <p>Marks</p>
          <p className="text-right">Created At</p>
        </div>

        <ul className="divide-y divide-border/60">
          {isLoadingRows || (isRefreshingRows && totalVisibleRows === 0)
            ? Array.from({ length: 6 }).map((_, index) => (
                <li
                  key={`skeleton-${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_86px] items-start gap-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 size-4 shrink-0 animate-pulse rounded-sm bg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-3/5 animate-pulse rounded-md bg-muted" />
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="h-3 w-24 animate-pulse rounded-md bg-muted/70" />
                      </div>
                    </div>
                  </div>
                  <div className="ml-auto h-3 w-11 animate-pulse rounded-md bg-muted/70" />
                </li>
              ))
            : null}

          {!isLoadingRows &&
            isXFolderSelected &&
            xBookmarksQuery.data?.error ? (
              <li className="px-2 py-10 text-center">
                <p className="text-sm text-foreground">{xBookmarksQuery.data.error}</p>
                {xBookmarksQuery.data.status ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    X API status {xBookmarksQuery.data.status}
                  </p>
                ) : null}
              </li>
            ) : null}

          {!isLoadingRows &&
            isXFolderSelected &&
            !xBookmarksQuery.data?.error &&
            displayedXRows.map((item) => (
              <li key={item.id} className="py-1">
                <ContextMenu>
                  <ContextMenuTrigger className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                    <div className="grid grid-cols-[minmax(0,1fr)_86px] items-start gap-3 rounded-md px-2 py-2 transition-all duration-150 hover:-translate-y-px hover:bg-muted/40 hover:shadow-sm hover:shadow-foreground/5 data-[state=open]:bg-muted/50">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground">
                          <SiX className="size-3.5" />
                        </span>
                        <div className="min-w-0">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm text-foreground hover:underline"
                          >
                            {item.title}
                          </a>
                          {search.trim() ? (
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs text-muted-foreground">
                                {item.username ? `@${item.username}` : item.authorName ?? "X"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <p className="pt-0.5 text-right text-xs text-muted-foreground">
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </p>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-44 rounded-lg p-1">
                    <ContextMenuItem onClick={() => void copyBookmarkUrl(item.url)}>
                      <ClipboardIcon />
                      Copy URL
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}>
                      <ExternalLinkIcon />
                      Open on X
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            ))}

          {!isLoadingRows &&
            isGitHubFolderSelected &&
            githubItemsQuery.data?.error ? (
              <li className="px-2 py-10 text-center">
                <p className="text-sm text-foreground">{githubItemsQuery.data.error}</p>
                {githubItemsQuery.data.status ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    GitHub API status {githubItemsQuery.data.status}
                  </p>
                ) : null}
              </li>
            ) : null}

          {!isLoadingRows &&
            isGitHubFolderSelected &&
            !githubItemsQuery.data?.error &&
            displayedGitHubRows.map((item) => (
              <li key={item.id} className="py-1">
                <ContextMenu>
                  <ContextMenuTrigger className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                    <div className="grid grid-cols-[minmax(0,1fr)_86px] items-start gap-3 rounded-md px-2 py-2 transition-all duration-150 hover:-translate-y-px hover:bg-muted/40 hover:shadow-sm hover:shadow-foreground/5 data-[state=open]:bg-muted/50">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground">
                          {item.type === "pulls" ? (
                            <GitPullRequestIcon className="size-3.5" />
                          ) : (
                            <SiGithub className="size-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm text-foreground hover:underline"
                          >
                            {item.title}
                          </a>
                          {search.trim() ? (
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs text-muted-foreground">
                                {item.author ? `@${item.author}` : "GitHub"}
                              </span>
                              <span className="inline-flex h-5 shrink-0 items-center rounded-full border bg-muted/60 px-2 text-[11px] font-medium text-muted-foreground">
                                {item.type}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <p className="pt-0.5 text-right text-xs text-muted-foreground">
                        {item.updatedAt || item.createdAt
                          ? new Date(item.updatedAt ?? item.createdAt ?? "").toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </p>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-44 rounded-lg p-1">
                    <ContextMenuItem onClick={() => void copyBookmarkUrl(item.url)}>
                      <ClipboardIcon />
                      Copy URL
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}>
                      <ExternalLinkIcon />
                      Open on GitHub
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            ))}

          {!isLoadingRows &&
            !isXFolderSelected &&
            !isGitHubFolderSelected &&
            displayedVisibleRows.map((item) => {
              const isLink = item.contentType === "link";
              const host = isLink ? getHostFromUrl(item.url) : "";
              const displayTitle = item.title || (isLink ? getDisplayLabelFromUrl(item.url) : item.url);
              const isSearching = Boolean(search.trim());
              const showMatchScore =
                searchMode === "semantic" &&
                isSearching &&
                typeof item.matchScore === "number";
              const primaryFaviconUrl = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : "";
              const fallbackFaviconUrl = host
                ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`
                : "";

              return (
                <li
                  key={item.id}
                  className="py-1"
                >
                  <ContextMenu>
                    <ContextMenuTrigger className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                      <div className="grid grid-cols-[minmax(0,1fr)_86px] items-start gap-3 rounded-md px-2 py-2 transition-all duration-150 hover:-translate-y-px hover:bg-muted/40 hover:shadow-sm hover:shadow-foreground/5 data-[state=open]:bg-muted/50">
                        <div className="flex min-w-0 items-start gap-2.5">
                          {isLink && host ? (
                            <img
                              src={primaryFaviconUrl}
                              alt=""
                              className="mt-0.5 size-4 shrink-0 rounded-sm"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                if (
                                  fallbackFaviconUrl &&
                                  event.currentTarget.src !== fallbackFaviconUrl
                                ) {
                                  event.currentTarget.src = fallbackFaviconUrl;
                                  return;
                                }
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] text-muted-foreground">
                              {isLink ? (
                                item.tag.slice(0, 1).toUpperCase()
                              ) : (
                                <FileTextIcon className="size-3" />
                              )}
                            </span>
                          )}
                          <div className="min-w-0">
                            {isLink ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-sm text-foreground hover:underline"
                              >
                                {displayTitle}
                              </a>
                            ) : (
                              <button
                                type="button"
                                className="block max-w-full truncate text-left text-sm text-foreground hover:underline"
                                onClick={() => void copyBookmarkUrl(item.url)}
                              >
                                {displayTitle}
                              </button>
                            )}
                            {isSearching ? (
                              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate text-xs text-muted-foreground">
                                  {host || item.tag}
                                </span>
                                {showMatchScore ? (
                                  <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border bg-muted/60 px-2 text-[11px] font-medium text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                    {item.matchScore === 100 ? "best match" : `${item.matchScore}% match`}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <p className="pt-0.5 text-right text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-44 rounded-lg p-1">
                      <ContextMenuItem onClick={() => void copyBookmarkUrl(item.url)}>
                        <ClipboardIcon />
                        {isLink ? "Copy URL" : "Copy Text"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          setRenamingBookmark(item);
                          setBookmarkTitleValue(displayTitle);
                        }}
                      >
                        <PencilIcon />
                        Rename title
                      </ContextMenuItem>
                      {isLink ? (
                        <ContextMenuItem
                          onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                        >
                          <ExternalLinkIcon />
                          Open Link
                        </ContextMenuItem>
                      ) : null}
                      <ContextMenuItem
                        disabled={refetchBookmarkMetadataMutation.isPending}
                        onClick={() => refetchBookmarkMetadataMutation.mutate(item.id)}
                      >
                        {refetchBookmarkMetadataMutation.isPending ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <RefreshCwIcon />
                        )}
                        Refetch metadata
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem disabled>
                        <CheckSquareIcon />
                        Select
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={deleteBookmarkMutation.isPending}
                        variant="destructive"
                        onClick={() => deleteBookmarkMutation.mutate(item.id)}
                      >
                        {deleteBookmarkMutation.isPending ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon />
                        )}
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </li>
              );
            })}

          {!isLoadingRows && hasMoreRows ? (
            <li ref={loadMoreRef} className="flex justify-center px-2 py-4">
              <span className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs text-muted-foreground shadow-sm shadow-foreground/5">
                <Loader2Icon className="size-3.5 animate-spin" />
                Loading more
              </span>
            </li>
          ) : null}

          {!isLoadingRows &&
          !xBookmarksQuery.data?.error &&
          !githubItemsQuery.data?.error &&
          totalVisibleRows === 0 ? (
            <li className="px-2 py-10 text-center text-sm text-muted-foreground">
              {isXFolderSelected
                ? "No X bookmarks found."
                : isGitHubFolderSelected
                  ? "No GitHub items found."
                  : "No bookmarks yet."}
            </li>
          ) : null}
        </ul>
      </div>
    </main>
  );
}

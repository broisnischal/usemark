import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckSquareIcon,
  ClipboardIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  RssIcon,
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
} from "@/lib/bookmarks/queries";

export const Route = createFileRoute("/_auth/app/")({
  component: AppIndex,
});

const BOOKMARK_INPUT_DEBOUNCE_MS = 300;

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
    const lastPathSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (lastPathSegment) {
      return decodeURIComponent(lastPathSegment).replace(/[-_]+/g, " ");
    }
    return parsed.hostname.replace(/^www\./, "");
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
  const [isRssFolderDialogOpen, setIsRssFolderDialogOpen] = React.useState(false);
  const [rssFeedUrl, setRssFeedUrl] = React.useState("");
  const debouncedInputValue = useDebouncedValue(inputValue, BOOKMARK_INPUT_DEBOUNCE_MS);
  const search = inputValue.trim() ? debouncedInputValue.trim() : "";

  const bookmarksQuery = useQuery(bookmarksQueryOptions());
  const foldersQuery = useQuery(bookmarkFoldersQueryOptions());
  const searchQuery = useQuery({
    ...bookmarkSearchQueryOptions(search),
    placeholderData: (previousData) => previousData,
  });

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
      toast.success(`${getFolderSourceLabel(folder.sourceType)} folder added.`);
      setIsRssFolderDialogOpen(false);
      setRssFeedUrl("");
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
        currentFolders?.map((folder) => ({ ...folder, isPinned: folder.id === folderId })),
      );
      setSelectedFolderId(folderId);

      return { previousFolders };
    },
    onSuccess: () => {
      toast.success("Pinned folder updated.");
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      const message = error instanceof Error ? error.message : "Could not pin folder.";
      toast.error(message);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey });
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
    setInputValue("");
    const targetFolder = selectedFolder ?? folders.find((folder) => folder.name === "default");
    createBookmarkMutation.mutate({
      url: nextUrl,
      folder: targetFolder?.name ?? "default",
      folderId: targetFolder?.id,
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

  const fetchedRows: BookmarkRecord[] = search.trim()
    ? (searchQuery.data ?? [])
    : (bookmarksQuery.data ?? []);
  const folders = foldersQuery.data ?? [];
  const pinnedFolder = folders.find((folder) => folder.isPinned) ?? null;
  const activeFolderId = selectedFolderId === undefined ? pinnedFolder?.id ?? null : selectedFolderId;
  const selectedFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const visibleRows = activeFolderId
    ? fetchedRows.filter((row) => row.folderId === activeFolderId)
    : fetchedRows;
  const liveFolderSourceTypes = new Set(
    folders.filter((folder) => folder.sourceType !== "local").map((folder) => folder.sourceType),
  );
  const isLoadingRows = search.trim() ? searchQuery.isLoading : bookmarksQuery.isLoading;
  const isRefreshingRows = search.trim() ? searchQuery.isFetching : bookmarksQuery.isFetching;

  const copyBookmarkUrl = React.useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Bookmark URL copied.");
    } catch {
      toast.error("Could not copy bookmark URL.");
    }
  }, []);

  const refreshBookmarkRows = React.useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
    ]);
    toast.success("Refreshing bookmark data.");
  }, [queryClient]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mx-auto w-full">
        <form className="mb-5" onSubmit={submitBookmark}>
          <div className="relative rounded-xl border bg-card">
            <PlusIcon className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
            <Input
              className="h-11 rounded-xl border-0 bg-transparent pr-20 pl-9 text-sm shadow-none focus-visible:ring-0"
              placeholder="Insert a link, color, or just plain text..."
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              required
            />
            <span className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              <CornerDownLeftIcon className="size-3.5" />
              add
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
              className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-muted/60 aria-pressed:bg-muted"
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
                    className="inline-flex h-8 max-w-48 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-muted/60 aria-pressed:bg-muted data-[state=open]:bg-muted"
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
                    <PinIcon />
                    {folder.isPinned ? "Pinned" : "Pin folder"}
                  </ContextMenuItem>
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
                    <Trash2Icon />
                    Delete folder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
              <PlusIcon className="size-3.5" />
              Live folder
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72 rounded-lg p-1" align="start">
              {LIVE_FOLDER_OPTIONS.map((option) => {
                const alreadyAdded = option.sourceType !== "rss" && liveFolderSourceTypes.has(option.sourceType);

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
                disabled
                className="items-start gap-3 py-2.5"
              >
                <FolderIcon className="mt-0.5 size-4" />
                <span>
                  <span className="block text-sm text-foreground">Custom folder</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Manual naming and source setup is coming next.
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
                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={createLiveFolderMutation.isPending}
                  >
                    {createLiveFolderMutation.isPending ? "Adding..." : "Add live folder"}
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
          {isLoadingRows || (isRefreshingRows && visibleRows.length === 0)
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
            visibleRows.map((item) => {
              const isLink = item.contentType === "link";
              const host = isLink ? getHostFromUrl(item.url) : "";
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
                      <div className="grid grid-cols-[minmax(0,1fr)_86px] items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40 data-[state=open]:bg-muted/50">
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
                                {getDisplayLabelFromUrl(item.url)}
                              </a>
                            ) : (
                              <button
                                type="button"
                                className="block max-w-full truncate text-left text-sm text-foreground hover:underline"
                                onClick={() => void copyBookmarkUrl(item.url)}
                              >
                                {item.url}
                              </button>
                            )}
                            {/* <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs text-muted-foreground">
                                {host || item.tag}
                              </span>
                              {item.folderName !== "default" ? <Kbd>{item.folderName}</Kbd> : null}
                              {item.embeddingStatus !== "ready" ? (
                                <Kbd className="uppercase">{item.embeddingStatus}</Kbd>
                              ) : null}
                            </div> */}
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
                      {isLink ? (
                        <ContextMenuItem
                          onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                        >
                          <ExternalLinkIcon />
                          Open Link
                        </ContextMenuItem>
                      ) : null}
                      <ContextMenuItem onClick={refreshBookmarkRows}>
                        <RefreshCwIcon />
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
                        <Trash2Icon />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </li>
              );
            })}

          {!isLoadingRows && visibleRows.length === 0 ? (
            <li className="px-2 py-10 text-center text-sm text-muted-foreground">
              No bookmarks yet.
            </li>
          ) : null}
        </ul>
      </div>
    </main>
  );
}

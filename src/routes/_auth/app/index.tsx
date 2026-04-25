import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CornerDownLeftIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import type { BookmarkRecord } from "@/lib/bookmarks/functions";
import {
  bookmarkSearchQueryOptions,
  bookmarksQueryKey,
  bookmarksQueryOptions,
} from "@/lib/bookmarks/queries";

export const Route = createFileRoute("/_auth/app/")({
  component: AppIndex,
});

const BOOKMARK_INPUT_DEBOUNCE_MS = 300;

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
  const debouncedInputValue = useDebouncedValue(inputValue, BOOKMARK_INPUT_DEBOUNCE_MS);
  const search = inputValue.trim() ? debouncedInputValue.trim() : "";

  const bookmarksQuery = useQuery(bookmarksQueryOptions());
  const searchQuery = useQuery({
    ...bookmarkSearchQueryOptions(search),
    placeholderData: (previousData) => previousData,
  });

  const getTagFromUrl = React.useCallback((urlValue: string) => {
    try {
      const host = new URL(urlValue).hostname.replace(/^www\./, "").toLowerCase();
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
    mutationFn: async (payload: { url: string; folder: string }) => {
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
      const optimisticRow: BookmarkRecord = {
        id: optimisticId,
        url: payload.url,
        tag: getTagFromUrl(payload.url),
        folderId: optimisticId,
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

  const submitBookmark = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = inputValue.trim();
    if (!nextUrl) {
      return;
    }
    setInputValue("");
    createBookmarkMutation.mutate({ url: nextUrl, folder: "default" });
  };

  const fetchedRows: BookmarkRecord[] = search.trim()
    ? (searchQuery.data ?? [])
    : (bookmarksQuery.data ?? []);
  const isLoadingRows = search.trim() ? searchQuery.isLoading : bookmarksQuery.isLoading;
  const isRefreshingRows = search.trim() ? searchQuery.isFetching : bookmarksQuery.isFetching;

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

        <div className="grid grid-cols-[minmax(0,1fr)_86px] border-b pb-2 text-sm text-muted-foreground">
          <p>Marks</p>
          <p className="text-right">Created At</p>
        </div>

        <ul className="divide-y divide-border/60">
          {isLoadingRows || (isRefreshingRows && fetchedRows.length === 0)
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
            fetchedRows.map((item) => {
              const host = getHostFromUrl(item.url);
              const primaryFaviconUrl = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : "";
              const fallbackFaviconUrl = host
                ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`
                : "";

              return (
                <li
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_86px] items-start gap-3 py-3"
                >

<ContextMenu>
  <ContextMenuTrigger>
  <div>
  <div className="flex min-w-0 items-start gap-2.5">
                    {host ? (
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
                        {item.tag.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm text-foreground hover:underline"
                      >
                        {getDisplayLabelFromUrl(item.url)}
                      </a>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">
                          {host || item.tag}
                        </span>
                        {item.folderName !== "default" ? <Kbd>{item.folderName}</Kbd> : null}
                        {item.embeddingStatus !== "ready" ? (
                          <Kbd className="uppercase">{item.embeddingStatus}</Kbd>
                        ) : null}
                      </div>
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
  <ContextMenuContent>
  <ContextMenuItem>Copy</ContextMenuItem>

    <ContextMenuItem>Delete</ContextMenuItem>
    <ContextMenuItem>Refetch</ContextMenuItem> 
    {/* refetch metadata */}
    <ContextMenuItem>Select</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
                 
                </li>
              );
            })}

          {!isLoadingRows && fetchedRows.length === 0 ? (
            <li className="px-2 py-10 text-center text-sm text-muted-foreground">
              No bookmarks yet.
            </li>
          ) : null}
        </ul>
      </div>
    </main>
  );
}

import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, CheckIcon, SearchIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { HoldToDelete } from "@/components/hold-to-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RSS_FEED_CATALOG_PACKS } from "@/lib/bookmarks/feed-catalog";
import {
  bookmarksQueryKey,
  bookmarkFoldersQueryKey,
  bookmarkFoldersQueryOptions,
} from "@/lib/bookmarks/queries";

export const Route = createFileRoute("/_auth/app/feeds")({
  head: () => ({
    meta: [{ title: "Feeds — UseMark" }],
  }),
  component: FeedsPage,
});

function feedHost(feedUrl: string): string {
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function FeedsPage() {
  const queryClient = useQueryClient();
  const foldersQuery = useQuery(bookmarkFoldersQueryOptions());
  const [search, setSearch] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  const followedFeedFoldersByUrl = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const folder of foldersQuery.data ?? []) {
      if (folder.sourceType === "rss" && folder.externalResourceId) {
        try {
          map.set(new URL(folder.externalResourceId).toString(), {
            id: folder.id,
            name: folder.name,
          });
        } catch {
          map.set(folder.externalResourceId, { id: folder.id, name: folder.name });
        }
      }
    }
    return map;
  }, [foldersQuery.data]);

  const isFollowing = React.useCallback(
    (feedUrl: string) => {
      try {
        return followedFeedFoldersByUrl.has(new URL(feedUrl).toString());
      } catch {
        return followedFeedFoldersByUrl.has(feedUrl);
      }
    },
    [followedFeedFoldersByUrl],
  );

  const getFollowedFolderForFeed = React.useCallback(
    (feedUrl: string) => {
      try {
        return followedFeedFoldersByUrl.get(new URL(feedUrl).toString()) ?? null;
      } catch {
        return followedFeedFoldersByUrl.get(feedUrl) ?? null;
      }
    },
    [followedFeedFoldersByUrl],
  );

  const normalizedSearch = search.trim().toLowerCase();

  const visiblePacks = React.useMemo(() => {
    if (!normalizedSearch) {
      return RSS_FEED_CATALOG_PACKS.map((pack) => ({
        ...pack,
        visibleFeeds: pack.feeds,
      }));
    }

    return RSS_FEED_CATALOG_PACKS.map((pack) => {
      const visibleFeeds = pack.feeds.filter((feed) => {
        const haystack =
          `${feed.title} ${feedHost(feed.feedUrl)} ${pack.title} ${pack.category}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      });
      return {
        ...pack,
        visibleFeeds,
      };
    }).filter((pack) => pack.visibleFeeds.length > 0);
  }, [normalizedSearch]);

  const followFeedsMutation = useMutation({
    mutationFn: async (feeds: Array<{ name: string; feedUrl: string }>) => {
      const response = await fetch("/api/bookmark-folders/rss-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeds }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          body?.error ?? (response.status === 401 ? "Please sign in." : "Could not add feeds."),
        );
      }
      return (await response.json()) as {
        created: number;
        skipped: number;
        invalid: number;
      };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey });
      toast.success("Feeds updated", {
        description: `${result.created} added, ${result.skipped} already followed, ${result.invalid} invalid.`,
      });
    },
    onError: (error) => {
      toast.error("Could not update feeds", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });

  const unfollowFeedMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folderId, action: "unfollow" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not unfollow feed.");
      }
      return (await response.json()) as {
        success: true;
        id: string;
        movedImportant: number;
      };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey });
      await queryClient.invalidateQueries({ queryKey: bookmarksQueryKey });
      toast.success("Feed unfollowed", {
        description:
          result.movedImportant > 0
            ? `${result.movedImportant} important bookmark${result.movedImportant === 1 ? "" : "s"} moved to important.`
            : "All non-important bookmarks from this feed were removed.",
      });
    },
    onError: (error) => {
      toast.error("Could not unfollow feed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });

  const followOne = (title: string, feedUrl: string) => {
    followFeedsMutation.mutate([{ name: title, feedUrl }]);
  };

  const _followPack = (
    _packTitle: string,
    feeds: readonly { title: string; feedUrl: string }[],
  ) => {
    followFeedsMutation.mutate(
      feeds.map((feed) => ({
        name: feed.title,
        feedUrl: feed.feedUrl,
      })),
    );
  };

  useHotkey("/", (event) => {
    const activeEl = document.activeElement;
    if (
      activeEl instanceof HTMLInputElement ||
      activeEl instanceof HTMLTextAreaElement ||
      activeEl instanceof HTMLSelectElement
    ) {
      return;
    }
    if (activeEl instanceof HTMLElement && activeEl.isContentEditable) {
      return;
    }
    event.preventDefault();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  });

  return (
    <div className="relative mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-14 -z-10 h-56 bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.01_250/.7),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.3_0.02_250/.25),transparent_70%)]"
      />
      <div className="mb-8 flex flex-col gap-4 sm:mb-9">
        <div>
          <Link
            to="/app"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to marks
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Feed directory
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Browse suggested sources and follow them as RSS live folders. New accounts already
            include Hacker News — you can add more here anytime.
          </p>
          <div className="relative mt-4 max-w-md">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/80" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search feeds, sites, or category"
              className="h-9 rounded-lg border-border/70 bg-background pr-8 pl-8.5 shadow-none"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] font-medium text-muted-foreground/70">
              /
            </span>
          </div>
        </div>
      </div>

      <ul className="grid gap-6 sm:gap-7">
        {visiblePacks.map((pack) => {
          const _allFollowed =
            pack.visibleFeeds.length > 0 && pack.visibleFeeds.every((f) => isFollowing(f.feedUrl));
          return (
            <li
              key={pack.id}
              className="overflow-hidden rounded-xl border border-border/70 bg-background"
            >
              <div className="border-b border-border/60 px-4 py-3.5 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <span className="frappe-chip text-[0.65rem] tracking-wider uppercase">
                      {pack.category}
                    </span>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                      {pack.title}
                    </h2>
                    <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                      {pack.description}
                    </p>
                  </div>
                  {/*
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0"
                    disabled={followFeedsMutation.isPending || allFollowed}
                    onClick={() => followPack(pack.title, pack.feeds)}
                  >
                    {allFollowed ? (
                      <>
                        <CheckIcon className="size-3.5" />
                        Pack followed
                      </>
                    ) : followFeedsMutation.isPending ? (
                      <>
                        <Loader2Icon className="size-3.5 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      `Follow all (${pack.visibleFeeds.length})`
                    )}
                  </Button>
                  */}
                </div>
              </div>
              <ul className="divide-y divide-border/60">
                {pack.visibleFeeds.map((feed) => {
                  const following = isFollowing(feed.feedUrl);
                  return (
                    <li
                      key={feed.feedUrl}
                      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20 sm:px-5"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{feed.title}</p>
                        <span className="shrink-0 text-xs text-muted-foreground/50">/</span>
                        <p className="truncate text-xs text-muted-foreground">
                          {feedHost(feed.feedUrl)}
                        </p>
                      </div>
                      {following ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            <CheckIcon className="size-3.5" />
                            Following
                          </span>
                          <HoldToDelete
                            disabled={
                              followFeedsMutation.isPending || unfollowFeedMutation.isPending
                            }
                            isPending={unfollowFeedMutation.isPending}
                            className="h-8 px-2.5 text-xs"
                            onDelete={() => {
                              const followedFolder = getFollowedFolderForFeed(feed.feedUrl);
                              if (followedFolder) {
                                unfollowFeedMutation.mutate(followedFolder.id);
                              }
                            }}
                          >
                            Unfollow
                          </HoldToDelete>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={followFeedsMutation.isPending || unfollowFeedMutation.isPending}
                          onClick={() => followOne(feed.title, feed.feedUrl)}
                        >
                          Follow
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {visiblePacks.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          No feeds match your search.
        </p>
      ) : null}

      <p className="mt-10 text-center text-xs text-muted-foreground">
        Feeds sync in the background. Manage intervals from each folder’s menu on{" "}
        <Link to="/app" className="underline underline-offset-2 hover:text-foreground">
          Marks
        </Link>
        .
      </p>
    </div>
  );
}

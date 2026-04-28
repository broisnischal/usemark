import { SiGithub, SiReddit, SiX } from "@icons-pack/react-simple-icons";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import Fuse from "fuse.js";
import {
  BookOpenIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ClipboardIcon,
  Clock3Icon,
  CornerDownLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FlagIcon,
  FolderIcon,
  GitPullRequestIcon,
  GlobeIcon,
  ListTodoIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import * as React from "react";
import { toast } from "sonner";

import { HoldToDelete } from "@/components/hold-to-delete";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
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
  githubReposQueryKey,
  githubReposQueryOptions,
  xBookmarksQueryKey,
  xBookmarksQueryOptions,
} from "@/lib/bookmarks/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/app/")({
  /**
   * Cloudflare Workers Free ≈ 10ms CPU per request. This screen is huge; SSR it
   * reliably blows that budget (1102). Client-only here keeps the HTML shell
   * from parent routes + API-driven data after hydration.
   */
  ssr: false,
  pendingComponent: () => (
    <div className="mx-auto flex w-full max-w-6xl justify-center px-4 pt-24 text-sm text-muted-foreground">
      Loading marks…
    </div>
  ),
  component: AppIndex,
});

const BOOKMARK_INPUT_DEBOUNCE_MS = 300;
const ROW_PAGE_SIZE = 40;
const VIRTUAL_ROW_ESTIMATE_PX = 45;
const VIRTUAL_ROW_OVERSCAN = 10;
const SEARCH_STATE_STORAGE_KEY = "usemarks.search";

type BookmarkSearchMode = "semantic" | "fuzzy" | "exact";
type GitHubResourceType = "all" | "issues" | "pulls" | "releases";
type ProfileConnectionAccount = {
  id: string;
  providerId: string;
  accountId: string;
  scope: string | null;
  createdAt: string;
};

type ProfileConnectionResponse = {
  connections: {
    accounts: ProfileConnectionAccount[];
  };
};

function isBookmarkSearchMode(value: unknown): value is BookmarkSearchMode {
  return value === "semantic" || value === "fuzzy" || value === "exact";
}

function compareBookmarkFolders(first: BookmarkFolderRecord, second: BookmarkFolderRecord) {
  if (first.name === "default" && second.name !== "default") {
    return -1;
  }
  if (second.name === "default" && first.name !== "default") {
    return 1;
  }
  if (first.isPinned !== second.isPinned) {
    return first.isPinned ? -1 : 1;
  }
  return first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
}

/** Fixed display width avoids column jump between loading, empty, and varying date strings. */
const CREATED_AT_COL_W = "10rem";

function getCreatedAtDisplay(iso: string | null | undefined) {
  if (!iso) {
    return null;
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const datePart = parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  return {
    iso,
    datePart,
    timeStr: `${hh}:${mm}`,
    title: parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
  };
}

function CreatedAtCell({
  iso,
  inheritLinkTint,
}: {
  iso: string | null | undefined;
  /** When the row is an `<a href>`, inherit `visited:` text color from the anchor for the date line. */
  inheritLinkTint?: boolean;
}) {
  const value = getCreatedAtDisplay(iso);
  return (
    <div className="flex w-full justify-end self-center">
      {value ? (
        <time
          dateTime={value.iso}
          title={value.title}
          className={cn(
            "inline-block shrink-0 text-right text-xs leading-none whitespace-nowrap [font-variant-numeric:tabular-nums]",
            inheritLinkTint ? "text-inherit" : "text-muted-foreground",
          )}
          style={{ width: CREATED_AT_COL_W }}
        >
          <span
            className={cn("font-medium", inheritLinkTint ? "text-inherit" : "text-foreground/90")}
          >
            {value.datePart}
          </span>
          <span aria-hidden> | </span>
          <span>{value.timeStr}</span>
        </time>
      ) : (
        <span className="inline-block shrink-0" style={{ width: CREATED_AT_COL_W }} aria-hidden />
      )}
    </div>
  );
}

function isSafeExternalBookmarkHref(url: string) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Use a real `<a href>` for external link rows so `:visited` matches the browser history (native
 * visited styling). Falls back to `<button>` for todo mode, selection mode, or non-http(s) URLs.
 */
function BookmarkRowInteractive({
  useAnchor,
  href,
  className,
  onButtonClick,
  onButtonKeyDown,
  onMouseEnter,
  onFocus,
  children,
}: {
  useAnchor: boolean;
  href: string;
  className: string;
  onButtonClick: () => void;
  onButtonKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onMouseEnter?: React.MouseEventHandler<HTMLElement>;
  onFocus?: React.FocusEventHandler<HTMLElement>;
  children: React.ReactNode;
}) {
  const safeHref = href.trim();
  if (useAnchor && safeHref) {
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            window.open(safeHref, "_blank", "noopener,noreferrer");
          }
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onButtonClick}
      onKeyDown={onButtonKeyDown}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
    >
      {children}
    </button>
  );
}

function readStoredSearchState() {
  if (typeof window === "undefined") {
    return { searchMode: "semantic" as BookmarkSearchMode };
  }

  try {
    const rawSearchState = window.localStorage.getItem(SEARCH_STATE_STORAGE_KEY);
    if (!rawSearchState) {
      return { searchMode: "semantic" as BookmarkSearchMode };
    }

    const parsedSearchState = JSON.parse(rawSearchState) as {
      searchMode?: unknown;
    };

    return {
      searchMode: isBookmarkSearchMode(parsedSearchState.searchMode)
        ? parsedSearchState.searchMode
        : "semantic",
    };
  } catch {
    window.localStorage.removeItem(SEARCH_STATE_STORAGE_KEY);
    return { searchMode: "semantic" as BookmarkSearchMode };
  }
}

function escapeCsvValue(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toBookmarksCsv(rows: BookmarkRecord[]) {
  const header = ["id", "title", "url", "tag", "folder", "contentType", "createdAt"].join(",");
  const body = rows.map((row) =>
    [row.id, row.title ?? "", row.url, row.tag, row.folderName, row.contentType, row.createdAt]
      .map((value) => escapeCsvValue(String(value)))
      .join(","),
  );
  return [header, ...body].join("\n");
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

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
  if (
    normalized === "pr" ||
    normalized === "prs" ||
    normalized === "pull" ||
    normalized === "pulls"
  ) {
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

function parseTodoFolderCommand(value: string) {
  const match = value.trim().match(/^todo:([a-z0-9][a-z0-9-_ ]*)$/i);
  if (!match?.[1]) {
    return null;
  }
  const folderName = match[1].trim();
  return folderName.length > 0 ? folderName : null;
}

function parseMediumFeedCommand(value: string) {
  const match = value.trim().match(/^(?:medium)\s*:\s*(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  const raw = match[1]
    .trim()
    .replace(/^https?:\/\/medium\.com\//i, "")
    .replace(/^@/, "")
    .replace(/^feed\//i, "")
    .replace(/\/+$/g, "");
  if (!raw) {
    return null;
  }
  const slug = raw.replace(/^@/, "");
  const normalized = slug.startsWith("@") ? slug : `@${slug}`;
  return {
    name: `medium:${normalized}`,
    feedUrl: `https://medium.com/feed/${normalized}`,
  };
}

function parseDevtoFeedCommand(value: string) {
  const match = value.trim().match(/^(?:devto|dev\.to)\s*:\s*(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  const raw = match[1]
    .trim()
    .replace(/^https?:\/\/dev\.to\//i, "")
    .replace(/^feed\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/g, "");
  if (!raw) {
    return null;
  }
  const username = raw.split("/")[0]?.trim();
  if (!username) {
    return null;
  }
  return {
    name: `devto:${username}`,
    feedUrl: `https://dev.to/feed/${username}`,
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

function getRedditSubredditFromUrl(urlValue: string) {
  try {
    const parsed = new URL(urlValue);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "reddit.com" && host !== "old.reddit.com") {
      return "";
    }

    const [, firstSegment, subreddit] = parsed.pathname.split("/");
    return firstSegment?.toLowerCase() === "r" && subreddit
      ? `${decodeURIComponent(subreddit)}`
      : "";
  } catch {
    return "";
  }
}

function isHackerNewsUrl(urlValue: string) {
  try {
    const host = new URL(urlValue).hostname.replace(/^www\./, "").toLowerCase();
    return host === "news.ycombinator.com" || host === "hn.algolia.com";
  } catch {
    return false;
  }
}

function toHackerNewsSubmitUrl(urlValue: string, title?: string | null) {
  const params = new URLSearchParams({ u: urlValue });
  const normalizedTitle = title?.trim();
  if (normalizedTitle) {
    params.set("t", normalizedTitle);
  }
  return `https://news.ycombinator.com/submitlink?${params.toString()}`;
}

interface AdvancedSearchQuery {
  text: string;
  filters: {
    host: string[];
    path: string[];
    folder: string[];
    tag: string[];
    type: BookmarkContentType[];
    subreddit: string[];
    later: boolean | null;
    important: boolean | null;
    isPublic: boolean | null;
  };
}

function pushUnique<TValue>(list: TValue[], value: TValue) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function cleanSearchFilterValue(value: string) {
  return value
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
}

function parseBooleanSearchValue(value: string) {
  if (value === "true" || value === "yes" || value === "1" || value === "on") {
    return true;
  }
  if (value === "false" || value === "no" || value === "0" || value === "off") {
    return false;
  }
  return null;
}

function toggleSearchToken(input: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenRegex = new RegExp(`(?:^|\\s)${escapedToken}(?=\\s|$)`, "i");
  const withoutToken = input.replace(tokenRegex, " ").replace(/\s+/g, " ").trim();
  if (tokenRegex.test(input)) {
    return withoutToken;
  }
  return [withoutToken, token].filter(Boolean).join(" ").trim();
}

function clearFlagTokens(input: string) {
  return input
    .replace(
      /\b(later|important|public|visibility):(?:true|false|yes|no|1|0|on|off|private|public)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseAdvancedSearchQuery(query: string): AdvancedSearchQuery {
  const filters: AdvancedSearchQuery["filters"] = {
    host: [],
    path: [],
    folder: [],
    tag: [],
    type: [],
    subreddit: [],
    later: null,
    important: null,
    isPublic: null,
  };
  const textTokens: string[] = [];

  for (const token of query.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []) {
    const match = token.match(/^([a-z]+):(.+)$/i);
    if (!match?.[1] || !match[2]) {
      textTokens.push(token);
      continue;
    }

    const key = match[1].toLowerCase();
    const value = cleanSearchFilterValue(match[2]);
    if (!value) {
      continue;
    }

    if (key === "host" || key === "site" || key === "domain") {
      pushUnique(filters.host, value.replace(/^www\./, "").replace(/^\*\./, ""));
      continue;
    }
    if (key === "path" || key === "urlpath" || key === "pathname") {
      pushUnique(filters.path, value);
      continue;
    }
    if (key === "folder" || key === "in") {
      pushUnique(filters.folder, value);
      continue;
    }
    if (key === "tag" || key === "label") {
      pushUnique(filters.tag, value);
      continue;
    }
    if ((key === "type" || key === "content") && (value === "link" || value === "text")) {
      pushUnique(filters.type, value);
      continue;
    }
    if (key === "subreddit" || key === "sub" || key === "r") {
      pushUnique(filters.subreddit, value.replace(/^r\//, ""));
      continue;
    }
    if (key === "later") {
      const parsed = parseBooleanSearchValue(value);
      if (typeof parsed === "boolean") {
        filters.later = parsed;
        continue;
      }
    }
    if (key === "important") {
      const parsed = parseBooleanSearchValue(value);
      if (typeof parsed === "boolean") {
        filters.important = parsed;
        continue;
      }
    }
    if (key === "public" || key === "visibility") {
      if (value === "public" || value === "private") {
        filters.isPublic = value === "public";
        continue;
      }
      const parsed = parseBooleanSearchValue(value);
      if (typeof parsed === "boolean") {
        filters.isPublic = parsed;
        continue;
      }
    }

    textTokens.push(token);
  }

  return { text: textTokens.join(" ").trim(), filters };
}

function getUrlPathFromUrlValue(urlValue: string) {
  try {
    const parsed = new URL(urlValue);
    return decodeURIComponent(`${parsed.pathname}${parsed.search}`).toLowerCase();
  } catch {
    return "";
  }
}

function bookmarkMatchesAdvancedFilters(
  row: BookmarkRecord,
  filters: AdvancedSearchQuery["filters"],
) {
  const host = getHostFromUrlValue(row.url).toLowerCase();
  const path = getUrlPathFromUrlValue(row.url);
  const subreddit = getRedditSubredditFromUrl(row.url).replace(/^r\//, "").toLowerCase();
  const folderName = row.folderName.toLowerCase();
  const tag = row.tag.toLowerCase();

  return (
    filters.host.every((value) => host === value || host.endsWith(`.${value}`)) &&
    filters.path.every((value) =>
      value.startsWith("/") || value.startsWith("?")
        ? path.startsWith(value)
        : path.includes(value),
    ) &&
    filters.folder.every((value) => folderName.includes(value)) &&
    filters.tag.every((value) => tag.includes(value)) &&
    filters.type.every((value) => row.contentType === value) &&
    filters.subreddit.every((value) => subreddit.includes(value)) &&
    (filters.later === null || row.saveForLater === filters.later) &&
    (filters.important === null || row.isImportant === filters.important) &&
    (filters.isPublic === null || (row.visibility === "public") === filters.isPublic)
  );
}

function bookmarkMatchesSearch(row: BookmarkRecord, query: string | AdvancedSearchQuery) {
  const advancedQuery = typeof query === "string" ? parseAdvancedSearchQuery(query) : query;
  if (!bookmarkMatchesAdvancedFilters(row, advancedQuery.filters)) {
    return false;
  }

  const normalizedQuery = advancedQuery.text.toLowerCase();
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
    getRedditSubredditFromUrl(row.url),
  ]
    .join(" ")
    .toLowerCase();

  return normalizedQuery
    .split(/\s+/g)
    .every((token) => token.length === 0 || searchableText.includes(token));
}

function toFuzzySearchText(row: BookmarkRecord) {
  return [
    row.title ?? "",
    row.url,
    row.tag,
    row.folderName,
    row.embeddingStatus,
    getHostFromUrlValue(row.url),
    getDisplayLabelFromUrlValue(row.url),
    getRedditSubredditFromUrl(row.url),
  ].join(" ");
}

function removeBookmarkRow(rows: BookmarkRecord[] | undefined, bookmarkId: string) {
  if (!rows) {
    return rows;
  }

  return rows.filter((row) => row.id !== bookmarkId);
}

function getBookmarkListFolderKey(queryKey: readonly unknown[]) {
  return typeof queryKey[2] === "string" ? queryKey[2] : "all";
}

function bookmarkBelongsInListCache(row: BookmarkRecord, queryKey: readonly unknown[]) {
  const folderKey = getBookmarkListFolderKey(queryKey);
  return folderKey === "all" || folderKey === row.folderId;
}

function getFolderSourceLabel(sourceType: BookmarkFolderSourceType) {
  if (sourceType === "todo") {
    return "Todo";
  }
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

function formatEmbeddingStatus(status: string) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "processing") {
    return "Processing";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "pending") {
    return "Pending";
  }
  return "Unknown";
}

function hasRepoScope(scope: string | null | undefined) {
  if (!scope) {
    return false;
  }

  const tokens = scope
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return tokens.some(
    (token) => token === "repo" || token === "public_repo" || token.startsWith("repo:"),
  );
}

function isTodoFolderName(name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "todo" ||
    normalized.startsWith("todo:") ||
    normalized.startsWith("todo-") ||
    normalized.includes(" todo")
  );
}

function isTodoFolderRecord(folder: Pick<BookmarkFolderRecord, "name" | "sourceType">) {
  return (
    folder.sourceType === "todo" || (folder.sourceType === "local" && isTodoFolderName(folder.name))
  );
}

function getFolderDisplayName(folder: Pick<BookmarkFolderRecord, "name" | "sourceType">) {
  if (folder.sourceType === "todo" && folder.name.toLowerCase().startsWith("todo:")) {
    const withoutPrefix = folder.name.slice("todo:".length).trim();
    return withoutPrefix || "todo";
  }
  return folder.name;
}

function FolderSourceIcon({
  folder,
}: {
  folder: Pick<BookmarkFolderRecord, "name" | "sourceType">;
}) {
  if (isTodoFolderRecord(folder)) {
    return <ListTodoIcon className="size-3.5" />;
  }
  if (folder.sourceType === "github") {
    return <SiGithub className="size-3.5" />;
  }
  if (folder.sourceType === "x") {
    return <SiX className="size-3.5" />;
  }
  if (folder.sourceType === "reddit") {
    return <SiReddit className="size-3.5" />;
  }
  if (folder.sourceType === "rss") {
    return <RssIcon className="size-3.5" />;
  }

  return <FolderIcon className="size-3.5" />;
}

/** Shared styles for marks folder picker chips (wrap, no horizontal scroll). */
const MARKS_FOLDER_CHIP_CLASS =
  "inline-flex h-9 max-w-56 min-w-0 shrink-0 items-center gap-2 rounded-lg bg-muted/15 px-2.5 text-[15px] text-foreground transition-colors hover:bg-muted/35 aria-pressed:bg-primary/10 data-[popup-open]:bg-muted/40";

type MarksFolderPickerChipProps = {
  folder: BookmarkFolderRecord;
  isActive: boolean;
  onSelect: () => void;
  onPrefetch: () => void;
  pinFolderMutation: { isPending: boolean; mutate: (id: string) => void };
  syncFolderMutation: { isPending: boolean; mutate: (id: string) => void };
  markFolderSeenMutation: { mutate: (id: string) => void };
  deleteFolderMutation: { isPending: boolean; mutate: (id: string) => void };
  onOpenRssSettings: () => void;
  onExportJson: () => void | Promise<void>;
  onExportCsv: () => void | Promise<void>;
  onImport: () => void;
  onDelete: () => void;
};

function MarksFolderPickerChip({
  folder,
  isActive,
  onSelect,
  onPrefetch,
  pinFolderMutation,
  syncFolderMutation,
  markFolderSeenMutation,
  deleteFolderMutation,
  onOpenRssSettings,
  onExportJson,
  onExportCsv,
  onImport,
  onDelete,
}: MarksFolderPickerChipProps) {
  const baseTitle =
    folder.sourceType === "local" || folder.sourceType === "todo"
      ? getFolderDisplayName(folder)
      : `${getFolderSourceLabel(folder.sourceType)} live folder`;
  const title = `${baseTitle} · Right-click for folder actions`;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              MARKS_FOLDER_CHIP_CLASS,
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
            aria-pressed={isActive}
            title={title}
            onClick={onSelect}
            onFocus={onPrefetch}
            onMouseEnter={onPrefetch}
          />
        }
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <FolderSourceIcon folder={folder} />
        </span>
        <span className="min-w-0 truncate">{getFolderDisplayName(folder)}</span>
        {folder.isPinned ? (
          <PinIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
        ) : null}
        {folder.syncEnabled ? (
          <span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-emerald-500" title="Sync on" />
        ) : null}
        {folder.unseenCount > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
            {folder.unseenCount}
          </span>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
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
        {folder.sourceType !== "local" && folder.sourceType !== "todo" ? (
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
        {folder.sourceType === "rss" ? (
          <ContextMenuItem onClick={onOpenRssSettings}>
            <SlidersHorizontalIcon />
            RSS sync settings
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          disabled={folder.unseenCount === 0}
          onClick={() => markFolderSeenMutation.mutate(folder.id)}
        >
          <CheckSquareIcon />
          Mark as seen
        </ContextMenuItem>
        {folder.sourceType === "local" ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void onExportJson()}>
              <DownloadIcon />
              Export JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void onExportCsv()}>
              <DownloadIcon />
              Export CSV
            </ContextMenuItem>
            <ContextMenuItem onClick={onImport}>
              <UploadIcon />
              Import JSON/CSV
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuSeparator />
        <HoldToDelete
          mode="menu-item"
          disabled={folder.name === "default" || deleteFolderMutation.isPending}
          isPending={deleteFolderMutation.isPending}
          onDelete={onDelete}
        >
          Delete folder
        </HoldToDelete>
      </ContextMenuContent>
    </ContextMenu>
  );
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

function useWindowVirtualRange(itemCount: number, scope: string) {
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [range, setRange] = React.useState({ start: 0, end: Math.min(itemCount, ROW_PAGE_SIZE) });

  React.useEffect(() => {
    const updateRange = () => {
      const listElement = listRef.current;
      if (!listElement) {
        setRange({ start: 0, end: Math.min(itemCount, ROW_PAGE_SIZE) });
        return;
      }

      const rect = listElement.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const start = Math.max(
        0,
        Math.floor(-rect.top / VIRTUAL_ROW_ESTIMATE_PX) - VIRTUAL_ROW_OVERSCAN,
      );
      const end = Math.min(
        itemCount,
        Math.ceil((viewportHeight - rect.top) / VIRTUAL_ROW_ESTIMATE_PX) + VIRTUAL_ROW_OVERSCAN,
      );

      setRange((currentRange) =>
        currentRange.start === start && currentRange.end === end ? currentRange : { start, end },
      );
    };

    updateRange();
    window.addEventListener("scroll", updateRange, { passive: true });
    window.addEventListener("resize", updateRange);

    return () => {
      window.removeEventListener("scroll", updateRange);
      window.removeEventListener("resize", updateRange);
    };
  }, [itemCount, scope]);

  return [
    listRef,
    range.start,
    range.end,
    range.start * VIRTUAL_ROW_ESTIMATE_PX,
    Math.max(0, itemCount - range.end) * VIRTUAL_ROW_ESTIMATE_PX,
  ] as const;
}

function AppIndex() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const initialSearchState = React.useMemo(() => readStoredSearchState(), []);
  const [inputValue, setInputValue] = useQueryState(
    "q",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [folderQueryValue, setFolderQueryValue] = useQueryState(
    "folder",
    parseAsString.withDefault("auto").withOptions({ history: "replace" }),
  );
  const selectedFolderId =
    folderQueryValue === "auto" ? undefined : folderQueryValue === "all" ? null : folderQueryValue;
  const setSelectedFolderId = React.useCallback(
    (nextFolderId: string | null | undefined) => {
      void setFolderQueryValue(
        nextFolderId === undefined ? "auto" : nextFolderId === null ? "all" : nextFolderId,
      );
    },
    [setFolderQueryValue],
  );
  const [addFolderId, setAddFolderId] = React.useState<string | null>(null);
  const [searchMode, setSearchMode] = React.useState<BookmarkSearchMode>(
    initialSearchState.searchMode,
  );
  const [isRssFolderDialogOpen, setIsRssFolderDialogOpen] = React.useState(false);
  const [isGitHubFolderDialogOpen, setIsGitHubFolderDialogOpen] = React.useState(false);
  const [isCustomFolderDialogOpen, setIsCustomFolderDialogOpen] = React.useState(false);
  const [isHotkeysDialogOpen, setIsHotkeysDialogOpen] = React.useState(false);
  const [isRssSettingsDialogOpen, setIsRssSettingsDialogOpen] = React.useState(false);
  const [settingsFolderId, setSettingsFolderId] = React.useState<string | null>(null);
  const [renamingBookmark, setRenamingBookmark] = React.useState<BookmarkRecord | null>(null);
  const [rssFeedUrl, setRssFeedUrl] = React.useState("");
  const [githubRepoValue, setGithubRepoValue] = React.useState("");
  const [githubRepoListSearch, setGithubRepoListSearch] = React.useState("");
  const [githubResourceType, setGithubResourceType] = React.useState<GitHubResourceType>("all");
  const [rssSyncIntervalMinutesInput, setRssSyncIntervalMinutesInput] = React.useState("30");
  const [rssFetchLimitInput, setRssFetchLimitInput] = React.useState("100");
  const [rssKeepRecentCountInput, setRssKeepRecentCountInput] = React.useState("500");
  const [customFolderName, setCustomFolderName] = React.useState("");
  const [bookmarkTitleValue, setBookmarkTitleValue] = React.useState("");
  const [rowPagination, setRowPagination] = React.useState({
    scope: "",
    limit: ROW_PAGE_SIZE,
  });
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [isSelectionExportOpen, setIsSelectionExportOpen] = React.useState(false);
  const [selectedBookmarkIds, setSelectedBookmarkIds] = React.useState<string[]>([]);
  const [importFolderId, setImportFolderId] = React.useState<string | null>(null);
  const loadMoreRef = React.useRef<HTMLLIElement | null>(null);
  const bookmarkInputRef = React.useRef<HTMLInputElement | null>(null);
  const importBookmarksInputRef = React.useRef<HTMLInputElement | null>(null);
  const debouncedInputValue = useDebouncedValue(inputValue, BOOKMARK_INPUT_DEBOUNCE_MS);
  const search = inputValue.trim() ? debouncedInputValue.trim() : "";

  React.useEffect(() => {
    window.localStorage.setItem(SEARCH_STATE_STORAGE_KEY, JSON.stringify({ searchMode }));
  }, [searchMode]);

  const foldersQuery = useQuery(bookmarkFoldersQueryOptions());
  const folders = React.useMemo(
    () => [...(foldersQuery.data ?? [])].sort(compareBookmarkFolders),
    [foldersQuery.data],
  );
  const manualFolders = folders.filter(
    (folder) => folder.sourceType === "local" || folder.sourceType === "todo",
  );
  const pinnedFolder = folders.find((folder) => folder.isPinned) ?? null;
  const defaultFolder = manualFolders.find((folder) => folder.name === "default") ?? null;
  const activeFolderId =
    selectedFolderId === undefined
      ? (pinnedFolder?.id ?? defaultFolder?.id ?? null)
      : selectedFolderId;
  const selectedFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const settingsFolder = folders.find((folder) => folder.id === settingsFolderId) ?? null;
  const isXFolderSelected = selectedFolder?.sourceType === "x";
  const isGitHubFolderSelected = selectedFolder?.sourceType === "github";
  const isTodoFolderSelected = selectedFolder ? isTodoFolderRecord(selectedFolder) : false;
  const bookmarkPaginationScope = [activeFolderId ?? "all", searchMode, search].join(":");
  const bookmarkFetchLimit =
    rowPagination.scope === bookmarkPaginationScope
      ? Math.max(ROW_PAGE_SIZE * 2, rowPagination.limit + ROW_PAGE_SIZE)
      : ROW_PAGE_SIZE * 2;
  const bookmarksQuery = useQuery(
    bookmarksQueryOptions(
      activeFolderId,
      Boolean(foldersQuery.data) && !isXFolderSelected,
      bookmarkFetchLimit,
    ),
  );
  const searchQuery = useQuery({
    ...bookmarkSearchQueryOptions(search),
    enabled: searchMode === "semantic" && Boolean(search.trim()),
    placeholderData: (previousData) => previousData,
  });
  const xBookmarksQuery = useQuery(xBookmarksQueryOptions(isXFolderSelected));
  const githubConnectionQuery = useQuery({
    queryKey: ["profile", "github-connection"] as const,
    enabled: isGitHubFolderDialogOpen,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/profile", {
        method: "GET",
        signal,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401 ? "Please sign in." : "Could not load profile connection.",
        );
      }
      return (await response.json()) as ProfileConnectionResponse;
    },
  });
  const githubAccount = React.useMemo(
    () =>
      githubConnectionQuery.data?.connections.accounts.find(
        (account) => account.providerId === "github",
      ) ?? null,
    [githubConnectionQuery.data?.connections.accounts],
  );
  const hasGitHubConnection = Boolean(githubAccount);
  const hasGitHubRepoScope = hasRepoScope(githubAccount?.scope);
  const githubReposQuery = useQuery(
    githubReposQueryOptions(isGitHubFolderDialogOpen && hasGitHubConnection),
  );
  const refetchGitHubRepos = githubReposQuery.refetch;

  const filteredGithubRepos = React.useMemo(() => {
    const list = githubReposQuery.data?.repos ?? [];
    const query = githubRepoListSearch.trim().toLowerCase();
    if (!query) {
      return list;
    }
    return list.filter((repo) => repo.fullName.toLowerCase().includes(query));
  }, [githubRepoListSearch, githubReposQuery.data?.repos]);

  React.useEffect(() => {
    if (
      selectedFolderId &&
      !folders.some((folder) => folder.id === selectedFolderId) &&
      !foldersQuery.isLoading
    ) {
      setSelectedFolderId(undefined);
    }
  }, [folders, foldersQuery.isLoading, selectedFolderId, setSelectedFolderId]);

  React.useEffect(() => {
    if (!selectedFolder) {
      return;
    }

    if (selectedFolder.sourceType !== "local" && selectedFolder.sourceType !== "todo") {
      return;
    }

    setAddFolderId((currentAddFolderId) =>
      currentAddFolderId === selectedFolder.id ? currentAddFolderId : selectedFolder.id,
    );
  }, [selectedFolder]);

  const prefetchFolderRows = React.useCallback(
    (folder: BookmarkFolderRecord) => {
      if (folder.sourceType === "x") {
        void queryClient.prefetchQuery(xBookmarksQueryOptions(true));
        return;
      }

      if (folder.sourceType === "github") {
        void queryClient.prefetchQuery(bookmarksQueryOptions(folder.id, true, ROW_PAGE_SIZE * 2));
        return;
      }

      void queryClient.prefetchQuery(bookmarksQueryOptions(folder.id, true, ROW_PAGE_SIZE * 2));
    },
    [queryClient],
  );

  const prefetchAllRows = React.useCallback(() => {
    void queryClient.prefetchQuery(bookmarksQueryOptions(null, true, ROW_PAGE_SIZE * 2));
  }, [queryClient]);

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
          normalizedContent.contentType === "text" ? normalizedContent.content.slice(0, 80) : null,
        tag: getTagFromUrl(payload.url),
        saveForLater: false,
        isImportant: false,
        isCompleted: false,
        visibility: "private",
        folderId: payload.folderId ?? optimisticId,
        folderName: payload.folder || "default",
        embeddingStatus: "pending",
        createdAt: new Date().toISOString(),
      };

      queryClient
        .getQueriesData<BookmarkRecord[]>({ queryKey: [...bookmarksQueryKey, "list"] })
        .forEach(([queryKey]) => {
          if (!bookmarkBelongsInListCache(optimisticRow, queryKey)) {
            return;
          }

          queryClient.setQueryData(queryKey, (currentRows: BookmarkRecord[] | undefined) => [
            optimisticRow,
            ...(currentRows ?? []),
          ]);
        });
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

        queryClient.setQueriesData(
          { queryKey: [...bookmarksQueryKey, "list"] },
          replaceOptimisticRow,
        );
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

        queryClient.setQueriesData(
          { queryKey: [...bookmarksQueryKey, "list"] },
          removeOptimisticRow,
        );
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

        const message = response.status === 401 ? "Please sign in." : "Could not delete bookmark.";
        throw new Error(message);
      }

      return (await response.json()) as { success: true; id: string };
    },
    onMutate: async (bookmarkId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);

      const previousBookmarkLists = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: [...bookmarksQueryKey, "list"],
      });
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });

      queryClient.setQueriesData(
        { queryKey: [...bookmarksQueryKey, "list"] },
        (currentRows: BookmarkRecord[] | undefined) => removeBookmarkRow(currentRows, bookmarkId),
      );
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (currentRows: BookmarkRecord[] | undefined) =>
          removeBookmarkRow(currentRows, bookmarkId),
        );
      });

      return { previousBookmarkLists, previousSearches };
    },
    onSuccess: () => {
      toast.success("Bookmark deleted.");
    },
    onError: (error, _bookmarkId, context) => {
      context?.previousBookmarkLists.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
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

  const deleteBookmarksBulkMutation = useMutation({
    mutationFn: async (bookmarkIds: string[]) => {
      const response = await fetch("/api/bookmarks", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: bookmarkIds }),
      });
      if (!response.ok) {
        const message = response.status === 401 ? "Please sign in." : "Could not delete bookmarks.";
        throw new Error(message);
      }
      return (await response.json()) as { success: true; deletedCount: number };
    },
    onSuccess: (result) => {
      const count = result.deletedCount;
      setSelectedBookmarkIds([]);
      toast.success(count > 0 ? `Deleted ${count} bookmarks.` : "No bookmarks deleted.");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not delete bookmarks.";
      toast.error(message);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
  });

  const bulkUpdateBookmarkFlagsMutation = useMutation({
    mutationFn: async (payload: {
      ids: string[];
      changes: {
        saveForLater?: boolean;
        isImportant?: boolean;
        visibility?: "private" | "public";
      };
      successMessage: string;
    }) => {
      const uniqueIds = [...new Set(payload.ids)];
      if (uniqueIds.length === 0) {
        return { updatedCount: 0, successMessage: payload.successMessage };
      }
      await Promise.all(
        uniqueIds.map(async (id) => {
          const response = await fetch("/api/bookmarks", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id, action: "update-flags", ...payload.changes }),
          });
          if (!response.ok) {
            const errorBody = (await response.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(
              response.status === 401
                ? "Please sign in."
                : errorBody?.error || "Could not update selected bookmarks.",
            );
          }
        }),
      );
      return { updatedCount: uniqueIds.length, successMessage: payload.successMessage };
    },
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
      const targetIds = new Set(payload.ids);
      const previousBookmarkLists = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: [...bookmarksQueryKey, "list"],
      });
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });
      const applyChanges = (rows: BookmarkRecord[] | undefined) =>
        rows?.map((row) =>
          targetIds.has(row.id)
            ? {
                ...row,
                saveForLater:
                  typeof payload.changes.saveForLater === "boolean"
                    ? payload.changes.saveForLater
                    : row.saveForLater,
                isImportant:
                  typeof payload.changes.isImportant === "boolean"
                    ? payload.changes.isImportant
                    : row.isImportant,
                visibility: payload.changes.visibility ?? row.visibility,
              }
            : row,
        );
      queryClient.setQueriesData({ queryKey: [...bookmarksQueryKey, "list"] }, applyChanges);
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, applyChanges);
      });
      return { previousBookmarkLists, previousSearches };
    },
    onSuccess: (result) => {
      toast.success(
        result.updatedCount > 0
          ? `${result.successMessage} (${result.updatedCount})`
          : "No bookmarks updated.",
      );
    },
    onError: (error, _payload, context) => {
      context?.previousBookmarkLists.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      context?.previousSearches.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      const message =
        error instanceof Error ? error.message : "Could not update selected bookmarks.";
      toast.error(message);
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

      const previousBookmarkLists = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: [...bookmarksQueryKey, "list"],
      });
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });
      const renameRow = (currentRows: BookmarkRecord[] | undefined) =>
        currentRows?.map((row) => (row.id === payload.id ? { ...row, title: payload.title } : row));

      queryClient.setQueriesData({ queryKey: [...bookmarksQueryKey, "list"] }, renameRow);
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, renameRow);
      });

      return { previousBookmarkLists, previousSearches };
    },
    onSuccess: () => {
      toast.success("Bookmark title updated.");
      setRenamingBookmark(null);
      setBookmarkTitleValue("");
    },
    onError: (error, _payload, context) => {
      context?.previousBookmarkLists.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
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

  const updateBookmarkFlagsMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      saveForLater?: boolean;
      isImportant?: boolean;
      isCompleted?: boolean;
      visibility?: "private" | "public";
    }) => {
      const response = await fetch("/api/bookmarks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, action: "update-flags" }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          response.status === 401
            ? "Please sign in."
            : errorBody?.error || "Could not update bookmark.",
        );
      }
      return (await response.json()) as { success: true; id: string };
    },
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
      const previousBookmarkLists = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: [...bookmarksQueryKey, "list"],
      });
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });
      const applyChanges = (rows: BookmarkRecord[] | undefined) =>
        rows?.map((row) =>
          row.id === payload.id
            ? {
                ...row,
                saveForLater:
                  typeof payload.saveForLater === "boolean"
                    ? payload.saveForLater
                    : row.saveForLater,
                isImportant:
                  typeof payload.isImportant === "boolean" ? payload.isImportant : row.isImportant,
                isCompleted:
                  typeof payload.isCompleted === "boolean" ? payload.isCompleted : row.isCompleted,
                visibility: payload.visibility ?? row.visibility,
              }
            : row,
        );
      queryClient.setQueriesData({ queryKey: [...bookmarksQueryKey, "list"] }, applyChanges);
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, applyChanges);
      });
      return { previousBookmarkLists, previousSearches };
    },
    onError: (error, _payload, context) => {
      context?.previousBookmarkLists.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      context?.previousSearches.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      const message = error instanceof Error ? error.message : "Could not update bookmark.";
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
        throw new Error(
          response.status === 401 ? "Please sign in." : "Could not refetch metadata.",
        );
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

  const requestBookmarkEmbeddingMutation = useMutation({
    mutationFn: async (payload: { id: string; force?: boolean }) => {
      const response = await fetch("/api/bookmarks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: payload.id, action: "request-embedding", force: payload.force }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          response.status === 401
            ? "Please sign in."
            : errorBody?.error || "Could not queue embedding.",
        );
      }

      return (await response.json()) as { success: true; id: string; embeddingStatus: string };
    },
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: bookmarksQueryKey }),
        queryClient.cancelQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
      const previousBookmarkLists = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: [...bookmarksQueryKey, "list"],
      });
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });
      const setPending = (rows: BookmarkRecord[] | undefined) =>
        rows?.map((row) =>
          row.id === payload.id
            ? {
                ...row,
                embeddingStatus: "pending",
              }
            : row,
        );
      queryClient.setQueriesData({ queryKey: [...bookmarksQueryKey, "list"] }, setPending);
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, setPending);
      });
      return { previousBookmarkLists, previousSearches };
    },
    onSuccess: async () => {
      toast.success("Embedding queued. Processing will run in background.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "search"] }),
      ]);
    },
    onError: (error, _payload, context) => {
      context?.previousBookmarkLists.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      context?.previousSearches.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
      const message = error instanceof Error ? error.message : "Could not queue embedding.";
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: githubReposQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["profile", "github-connection"] }),
        queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
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

      const previousFolders =
        queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);
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
        syncIntervalMinutes: 30,
        rssFetchLimit: 100,
        rssKeepRecentCount: 500,
      };

      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) => [
          ...(currentFolders ?? []),
          optimisticFolder,
        ],
      );

      return { previousFolders, optimisticFolderId: optimisticFolder.id };
    },
    onSuccess: (folder, _payload, context) => {
      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) => {
          if (!currentFolders) {
            return [folder];
          }

          const replacedFolders = currentFolders.map((item) =>
            item.id === context?.optimisticFolderId ? folder : item,
          );

          if (replacedFolders.some((item) => item.id === folder.id)) {
            return replacedFolders;
          }

          return [...replacedFolders, folder];
        },
      );
      setSelectedFolderId(folder.id);
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
      if (folder.sourceType !== "local" && folder.sourceType !== "todo") {
        void (async () => {
          await queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey });
          if (folder.sourceType === "github") {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
              queryClient.invalidateQueries({ queryKey: githubReposQueryKey }),
              queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
            ]);
            return;
          }
          if (folder.sourceType === "x") {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: xBookmarksQueryKey }),
              queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
            ]);
            return;
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: bookmarksQueryKey }),
            queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey }),
          ]);
        })();
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

  React.useEffect(() => {
    if (!isGitHubFolderDialogOpen || !hasGitHubConnection) {
      return;
    }
    void refetchGitHubRepos();
  }, [hasGitHubConnection, isGitHubFolderDialogOpen, refetchGitHubRepos]);

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
      const previousFolders =
        queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);

      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) =>
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
      const previousFolders =
        queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);

      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) =>
          currentFolders
            ?.map((folder) => ({ ...folder, isPinned: folder.id === folderId }))
            .sort(
              (a, b) => Number(b.isPinned) - Number(a.isPinned) || a.name.localeCompare(b.name),
            ),
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
      const previousFolders =
        queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);

      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) =>
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
          ? queryClient.invalidateQueries({ queryKey: bookmarksQueryKey })
          : Promise.resolve(),
      ]);
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      const message = error instanceof Error ? error.message : "Could not sync folder.";
      toast.error(message);
    },
  });

  const configureRssSyncMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      syncIntervalMinutes: number;
      rssFetchLimit: number;
      rssKeepRecentCount: number;
    }) => {
      const response = await fetch("/api/bookmark-folders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: payload.id,
          action: "configure-sync",
          syncIntervalMinutes: payload.syncIntervalMinutes,
          rssFetchLimit: payload.rssFetchLimit,
          rssKeepRecentCount: payload.rssKeepRecentCount,
        }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error || "Could not save RSS sync settings.");
      }
      return (await response.json()) as { success: true; folder: BookmarkFolderRecord };
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) =>
          currentFolders?.map((folder) =>
            folder.id === result.folder.id ? result.folder : folder,
          ),
      );
      toast.success("RSS sync settings updated.");
      setIsRssSettingsDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: bookmarkFoldersQueryKey });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save RSS sync settings.");
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

      const previousFolders =
        queryClient.getQueryData<BookmarkFolderRecord[]>(bookmarkFoldersQueryKey);
      const previousBookmarkLists = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: [...bookmarksQueryKey, "list"],
      });
      const previousSearches = queryClient.getQueriesData<BookmarkRecord[]>({
        queryKey: ["bookmarks", "search"],
      });

      queryClient.setQueryData(
        bookmarkFoldersQueryKey,
        (currentFolders: BookmarkFolderRecord[] | undefined) =>
          currentFolders?.filter((folder) => folder.id !== folderId),
      );
      queryClient.setQueriesData(
        { queryKey: [...bookmarksQueryKey, "list"] },
        (currentRows: BookmarkRecord[] | undefined) =>
          currentRows?.filter((row) => row.folderId !== folderId),
      );
      previousSearches.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (currentRows: BookmarkRecord[] | undefined) =>
          currentRows?.filter((row) => row.folderId !== folderId),
        );
      });
      if (activeFolderId === folderId) {
        setSelectedFolderId(null);
      }

      return { previousFolders, previousBookmarkLists, previousSearches };
    },
    onSuccess: () => {
      toast.success("Folder deleted.");
    },
    onError: (error, _folderId, context) => {
      queryClient.setQueryData(bookmarkFoldersQueryKey, context?.previousFolders);
      context?.previousBookmarkLists.forEach(([queryKey, rows]) => {
        queryClient.setQueryData(queryKey, rows);
      });
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
    const todoFolderCommand = parseTodoFolderCommand(nextUrl);
    if (todoFolderCommand) {
      setInputValue("");
      createLiveFolderMutation.mutate({
        name: todoFolderCommand,
        sourceType: "todo",
      });
      return;
    }
    const mediumFeedCommand = parseMediumFeedCommand(nextUrl);
    if (mediumFeedCommand) {
      setInputValue("");
      createLiveFolderMutation.mutate({
        name: mediumFeedCommand.name,
        sourceType: "rss",
        externalResourceId: mediumFeedCommand.feedUrl,
      });
      return;
    }
    const devtoFeedCommand = parseDevtoFeedCommand(nextUrl);
    if (devtoFeedCommand) {
      setInputValue("");
      createLiveFolderMutation.mutate({
        name: devtoFeedCommand.name,
        sourceType: "rss",
        externalResourceId: devtoFeedCommand.feedUrl,
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
      sourceType: isTodoFolderName(name) ? "todo" : "local",
      externalResourceId: null,
    });
  };

  const openRssSettingsDialog = (folder: BookmarkFolderRecord) => {
    setSettingsFolderId(folder.id);
    setRssSyncIntervalMinutesInput(String(folder.syncIntervalMinutes));
    setRssFetchLimitInput(String(folder.rssFetchLimit));
    setRssKeepRecentCountInput(String(folder.rssKeepRecentCount));
    setIsRssSettingsDialogOpen(true);
  };

  const submitRssSettings = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settingsFolder) {
      return;
    }
    const syncIntervalMinutes = Number(rssSyncIntervalMinutesInput);
    const rssFetchLimit = Number(rssFetchLimitInput);
    const rssKeepRecentCount = Number(rssKeepRecentCountInput);
    if (
      !Number.isFinite(syncIntervalMinutes) ||
      !Number.isFinite(rssFetchLimit) ||
      !Number.isFinite(rssKeepRecentCount)
    ) {
      toast.error("Please enter valid numbers for all RSS settings.");
      return;
    }
    configureRssSyncMutation.mutate({
      id: settingsFolder.id,
      syncIntervalMinutes,
      rssFetchLimit,
      rssKeepRecentCount,
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

  const downloadBookmarks = React.useCallback(
    (filename: string, contents: string, type: string) => {
      if (typeof window === "undefined") {
        return;
      }
      const blob = new Blob([contents], { type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const exportFolderBookmarks = React.useCallback(
    async (folder: BookmarkFolderRecord, format: "json" | "csv") => {
      const response = await fetch(`/api/bookmarks?folderId=${encodeURIComponent(folder.id)}`);
      if (!response.ok) {
        throw new Error(response.status === 401 ? "Please sign in." : "Could not export folder.");
      }
      const rows = (await response.json()) as BookmarkRecord[];
      const safeName = folder.name.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-");
      if (format === "json") {
        downloadBookmarks(
          `${safeName || "folder"}-bookmarks.json`,
          JSON.stringify(rows, null, 2),
          "application/json;charset=utf-8",
        );
      } else {
        downloadBookmarks(
          `${safeName || "folder"}-bookmarks.csv`,
          toBookmarksCsv(rows),
          "text/csv;charset=utf-8",
        );
      }
      toast.success(`Exported ${rows.length} bookmarks from ${folder.name}.`);
    },
    [downloadBookmarks],
  );

  const promptImportBookmarks = React.useCallback((folderId: string) => {
    setImportFolderId(folderId);
    importBookmarksInputRef.current?.click();
  }, []);

  const onImportBookmarksFile = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file || !importFolderId) {
        return;
      }
      try {
        const raw = await file.text();
        const sourceName = file.name.toLowerCase();
        const importItems: Array<{
          url: string;
          note?: string;
          title?: string | null;
          folderId: string;
        }> = [];

        if (sourceName.endsWith(".json")) {
          const parsed = JSON.parse(raw) as Array<{
            url?: string;
            note?: string | null;
            title?: string | null;
          }>;
          for (const row of parsed) {
            const url = row?.url?.trim() ?? "";
            if (!url) {
              continue;
            }
            importItems.push({
              url,
              note: row.note ?? undefined,
              title: row.title ?? null,
              folderId: importFolderId,
            });
          }
        } else {
          const lines = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          const [headerLine, ...dataLines] = lines;
          const headers = parseCsvLine(headerLine ?? "").map((column) => column.toLowerCase());
          const urlIndex = headers.findIndex((column) => column === "url");
          const noteIndex = headers.findIndex((column) => column === "note");
          const titleIndex = headers.findIndex((column) => column === "title");
          if (urlIndex < 0) {
            throw new Error("CSV needs a url column.");
          }
          for (const line of dataLines) {
            const values = parseCsvLine(line);
            const url = (values[urlIndex] ?? "").trim();
            if (!url) {
              continue;
            }
            importItems.push({
              url,
              note: noteIndex >= 0 ? values[noteIndex] : undefined,
              title: titleIndex >= 0 ? values[titleIndex] : null,
              folderId: importFolderId,
            });
          }
        }

        if (importItems.length === 0) {
          throw new Error("No valid bookmark rows found.");
        }

        const response = await fetch("/api/bookmarks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ items: importItems }),
        });
        if (!response.ok) {
          throw new Error(
            response.status === 401 ? "Please sign in." : "Could not import bookmarks.",
          );
        }
        const result = (await response.json()) as {
          createdNow?: number;
          queued?: number;
          skipped?: number;
        };
        toast.success(
          `Imported ${result.createdNow ?? 0} now, queued ${result.queued ?? 0}, skipped ${result.skipped ?? 0}.`,
        );
        await queryClient.invalidateQueries({ queryKey: bookmarksQueryKey });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not import bookmarks.";
        toast.error(message);
      } finally {
        input.value = "";
        setImportFolderId(null);
      }
    },
    [importFolderId, queryClient],
  );

  const allRows = React.useMemo(() => bookmarksQuery.data ?? [], [bookmarksQuery.data]);
  const normalizedSearch = search.trim();
  const normalizedSearchLower = normalizedSearch.toLowerCase();
  const advancedSearchQuery = parseAdvancedSearchQuery(normalizedSearch);
  const filteredRows = allRows.filter((row) =>
    bookmarkMatchesAdvancedFilters(row, advancedSearchQuery.filters),
  );
  const fuzzyRows =
    advancedSearchQuery.text && searchMode === "fuzzy"
      ? new Fuse(filteredRows, {
          keys: [
            { name: "title", weight: 0.35 },
            { name: "url", weight: 0.25 },
            { name: "tag", weight: 0.15 },
            { name: "folderName", weight: 0.15 },
            {
              name: "fuzzyText",
              getFn: (row) => toFuzzySearchText(row as BookmarkRecord),
              weight: 0.1,
            },
          ],
          ignoreLocation: true,
          includeScore: true,
          minMatchCharLength: 2,
          threshold: 0.35,
        })
          .search(advancedSearchQuery.text)
          .map((result) => result.item)
      : filteredRows;
  const fetchedRows: BookmarkRecord[] = normalizedSearch
    ? searchMode === "semantic"
      ? (searchQuery.data ?? []).filter((row) => bookmarkMatchesSearch(row, advancedSearchQuery))
      : searchMode === "fuzzy"
        ? fuzzyRows
        : filteredRows.filter((row) => bookmarkMatchesSearch(row, advancedSearchQuery))
    : allRows;
  const addFolder =
    manualFolders.find((folder) => folder.id === addFolderId) ??
    (selectedFolder?.sourceType === "local" || selectedFolder?.sourceType === "todo"
      ? selectedFolder
      : null) ??
    defaultFolder ??
    manualFolders[0] ??
    null;
  const isTodoAddTarget = addFolder ? isTodoFolderRecord(addFolder) : false;
  const visibleRows = isXFolderSelected
    ? []
    : activeFolderId
      ? fetchedRows.filter((row) => row.folderId === activeFolderId)
      : fetchedRows;
  const selectedBookmarkIdSet = React.useMemo(
    () => new Set(selectedBookmarkIds),
    [selectedBookmarkIds],
  );
  const selectedVisibleRows = visibleRows.filter((row) => selectedBookmarkIdSet.has(row.id));
  function exportSelectedBookmarks(format: "json" | "csv") {
    const selectedRows = selectedVisibleRows;
    if (selectedRows.length === 0) {
      toast.error("Select at least one bookmark to export.");
      return;
    }
    if (format === "json") {
      downloadBookmarks(
        `selected-bookmarks-${selectedRows.length}.json`,
        JSON.stringify(selectedRows, null, 2),
        "application/json;charset=utf-8",
      );
    } else {
      downloadBookmarks(
        `selected-bookmarks-${selectedRows.length}.csv`,
        toBookmarksCsv(selectedRows),
        "text/csv;charset=utf-8",
      );
    }
    toast.success(
      `Exported ${selectedRows.length} selected bookmark${selectedRows.length === 1 ? "" : "s"}.`,
    );
    setIsSelectionExportOpen(false);
  }
  const selectedVisibleCount = selectedVisibleRows.length;
  const allVisibleSelected = visibleRows.length > 0 && selectedVisibleCount === visibleRows.length;
  const xRows = (xBookmarksQuery.data?.bookmarks ?? []).filter((row) => {
    if (!isXFolderSelected || !normalizedSearchLower) {
      return true;
    }

    return [row.title, row.authorName ?? "", row.username ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearchLower);
  });
  const liveFolderSourceTypes = new Set(
    folders.filter((folder) => folder.sourceType !== "local").map((folder) => folder.sourceType),
  );
  /** First four sorted folders for Alt+1–4 (same order as on-screen chips). */
  const folderHotkeyTargets = folders.slice(0, 4);
  const isLoadingRows = isXFolderSelected
    ? xBookmarksQuery.isLoading
    : search.trim() && searchMode === "semantic"
      ? searchQuery.isLoading
      : bookmarksQuery.isLoading;
  const isRefreshingRows = isXFolderSelected
    ? xBookmarksQuery.isFetching
    : search.trim() && searchMode === "semantic"
      ? searchQuery.isFetching
      : bookmarksQuery.isFetching;
  const rowPaginationScope = [
    isXFolderSelected ? "x" : "bookmarks",
    activeFolderId ?? "all",
    searchMode,
    search,
  ].join(":");
  const visibleRowLimit =
    rowPagination.scope === rowPaginationScope ? rowPagination.limit : ROW_PAGE_SIZE;
  const totalVisibleRows = isXFolderSelected ? xRows.length : visibleRows.length;
  const hasMoreRows = totalVisibleRows > visibleRowLimit;
  const hasMoreBookmarkRowsFromServer =
    !isXFolderSelected &&
    !isLoadingRows &&
    (bookmarksQuery.data?.length ?? 0) >= bookmarkFetchLimit;
  const hasMoreRowsWithPagination = hasMoreRows || hasMoreBookmarkRowsFromServer;
  const displayedXRows = xRows.slice(0, visibleRowLimit);
  const displayedVisibleRows = visibleRows.slice(0, visibleRowLimit);
  const displayedRowCount = isXFolderSelected ? displayedXRows.length : displayedVisibleRows.length;
  const [virtualListRef, virtualStart, virtualEnd, virtualPaddingTop, virtualPaddingBottom] =
    useWindowVirtualRange(displayedRowCount, rowPaginationScope);
  const virtualDisplayedXRows = displayedXRows.slice(virtualStart, virtualEnd);
  const virtualDisplayedVisibleRows = displayedVisibleRows.slice(virtualStart, virtualEnd);
  const [hoveredBookmarkId, setHoveredBookmarkId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreRowsWithPagination || isLoadingRows) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRowPagination((currentPagination) => {
            const currentLimit =
              currentPagination.scope === rowPaginationScope
                ? currentPagination.limit
                : ROW_PAGE_SIZE;

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
  }, [hasMoreRowsWithPagination, isLoadingRows, rowPaginationScope, totalVisibleRows]);

  const focusBookmarkInput = React.useCallback(() => {
    bookmarkInputRef.current?.focus();
    bookmarkInputRef.current?.select();
  }, []);

  const hoveredBookmark = hoveredBookmarkId
    ? (visibleRows.find((row) => row.id === hoveredBookmarkId) ?? null)
    : null;

  const isInputLikeActiveElement = React.useCallback(() => {
    const activeElement = document.activeElement;
    const tagName = activeElement?.tagName.toLowerCase();
    return (
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      (activeElement instanceof HTMLElement && activeElement.isContentEditable)
    );
  }, []);

  useHotkey("/", () => {
    focusBookmarkInput();
  });
  useHotkey("Mod+Enter", () => {
    focusBookmarkInput();
  });
  useHotkey("Enter", () => {
    if (!isInputLikeActiveElement()) {
      focusBookmarkInput();
    }
  });

  useHotkey({ key: "m" }, () => {
    if (
      isInputLikeActiveElement() ||
      !hoveredBookmark ||
      isTodoFolderName(hoveredBookmark.folderName)
    ) {
      return;
    }
    updateBookmarkFlagsMutation.mutate({
      id: hoveredBookmark.id,
      isImportant: !hoveredBookmark.isImportant,
    });
  });

  useHotkey({ key: "l" }, () => {
    if (
      isInputLikeActiveElement() ||
      !hoveredBookmark ||
      isTodoFolderName(hoveredBookmark.folderName)
    ) {
      return;
    }
    updateBookmarkFlagsMutation.mutate({
      id: hoveredBookmark.id,
      saveForLater: !hoveredBookmark.saveForLater,
    });
  });

  useHotkey({ key: "p" }, () => {
    if (
      isInputLikeActiveElement() ||
      !hoveredBookmark ||
      isTodoFolderName(hoveredBookmark.folderName)
    ) {
      return;
    }
    updateBookmarkFlagsMutation.mutate({
      id: hoveredBookmark.id,
      visibility: hoveredBookmark.visibility === "public" ? "private" : "public",
    });
  });

  useHotkey({ key: "s" }, () => {
    if (isInputLikeActiveElement() || !hoveredBookmark) {
      return;
    }
    setIsSelectionMode(true);
    setSelectedBookmarkIds((current) => {
      if (current.includes(hoveredBookmark.id)) {
        return current;
      }
      return [...current, hoveredBookmark.id];
    });
  });

  useHotkey({ key: "c" }, () => {
    if (isInputLikeActiveElement() || !hoveredBookmark) {
      return;
    }
    void copyBookmarkUrl(hoveredBookmark.url);
  });

  useHotkey({ key: "r" }, () => {
    if (isInputLikeActiveElement() || !hoveredBookmark) {
      return;
    }
    setRenamingBookmark(hoveredBookmark);
    setBookmarkTitleValue(
      hoveredBookmark.title ||
        (hoveredBookmark.contentType === "link"
          ? getDisplayLabelFromUrl(hoveredBookmark.url)
          : hoveredBookmark.url),
    );
  });

  useHotkey("Mod+,", () => {
    void navigate({ to: "/app/profile" });
  });
  useHotkey("Alt+P", () => {
    void navigate({ to: "/app/profile" });
  });

  useHotkey("Alt+S", () => {
    setSearchMode((currentMode) =>
      currentMode === "semantic" ? "fuzzy" : currentMode === "fuzzy" ? "exact" : "semantic",
    );
  });
  useHotkey("Alt+Shift+1", () => setSearchMode("semantic"));
  useHotkey("Alt+Shift+2", () => setSearchMode("fuzzy"));
  useHotkey("Alt+Shift+3", () => setSearchMode("exact"));

  useHotkey("Alt+0", () => setSelectedFolderId(null));
  useHotkey("Alt+1", () => {
    setSelectedFolderId(folderHotkeyTargets[0]?.id ?? null);
  });
  useHotkey("Alt+2", () => {
    setSelectedFolderId(folderHotkeyTargets[1]?.id ?? null);
  });
  useHotkey("Alt+3", () => {
    setSelectedFolderId(folderHotkeyTargets[2]?.id ?? null);
  });
  useHotkey("Alt+4", () => {
    setSelectedFolderId(folderHotkeyTargets[3]?.id ?? null);
  });

  useHotkey({ key: "/", shift: true }, () => {
    setIsHotkeysDialogOpen(true);
  });

  const copyBookmarkUrl = React.useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Bookmark URL copied.");
    } catch {
      toast.error("Could not copy bookmark URL.");
    }
  }, []);

  const copyManyBookmarkUrls = React.useCallback(async (urls: string[]) => {
    const lines = urls.map((url) => url.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error("Select at least one bookmark with a URL.");
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success(`Copied ${lines.length} URL${lines.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Could not copy selected URLs.");
    }
  }, []);

  const openExternalUrl = React.useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const submitToHackerNews = React.useCallback(
    (url: string, title?: string | null) => {
      openExternalUrl(toHackerNewsSubmitUrl(url, title));
    },
    [openExternalUrl],
  );

  const activateBookmarkRow = React.useCallback(
    (item: BookmarkRecord) => {
      if (isTodoFolderName(item.folderName)) {
        return;
      }

      if (item.contentType === "link") {
        openExternalUrl(item.url);
        return;
      }

      void copyBookmarkUrl(item.url);
    },
    [copyBookmarkUrl, openExternalUrl],
  );

  const handleRowKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>, action: () => void) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      action();
    },
    [],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
      <div className="mx-auto w-full">
        <form className="mb-5" onSubmit={submitBookmark}>
          <div className="flex min-h-11 items-center rounded-lg border bg-card/90 shadow-sm shadow-foreground/5 transition-all duration-150 focus-within:border-ring/50 focus-within:ring-3 focus-within:ring-ring/10">
            <DropdownMenu>
              <DropdownMenuTrigger
                type="button"
                className="ml-1 inline-flex h-9 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
              >
                {addFolder ? (
                  <FolderSourceIcon folder={addFolder} />
                ) : (
                  <FolderIcon className="size-3.5" />
                )}
                <span className="truncate">
                  {addFolder ? getFolderDisplayName(addFolder) : "default"}
                </span>
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="start">
                {manualFolders.length > 0 ? (
                  manualFolders.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      className="gap-2"
                      onClick={() => {
                        setAddFolderId(folder.id);
                        setSelectedFolderId(folder.id);
                      }}
                    >
                      <FolderSourceIcon folder={folder} />
                      <span className="truncate">{getFolderDisplayName(folder)}</span>
                      {addFolder?.id === folder.id ? (
                        <CheckIcon className="ml-auto size-3.5 text-muted-foreground" />
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
              ref={bookmarkInputRef}
              className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
              placeholder={
                isTodoAddTarget
                  ? "Add your todo task..."
                  : searchMode === "semantic"
                    ? "Add a bookmark, or search semantically..."
                    : searchMode === "fuzzy"
                      ? "Add a bookmark, or fuzzy search..."
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
                  {searchMode === "semantic" ? "semantic" : searchMode}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52" align="end">
                <DropdownMenuItem className="gap-2" onClick={() => setSearchMode("semantic")}>
                  <SparklesIcon className="size-3.5" />
                  <span>Semantic search</span>
                  {searchMode === "semantic" ? (
                    <CheckSquareIcon className="ml-auto size-3.5 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={() => setSearchMode("fuzzy")}>
                  <SearchIcon className="size-3.5" />
                  <span>Fuzzy search</span>
                  {searchMode === "fuzzy" ? (
                    <CheckSquareIcon className="ml-auto size-3.5 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={() => setSearchMode("exact")}>
                  <SearchIcon className="size-3.5" />
                  <span>Exact search</span>
                  {searchMode === "exact" ? (
                    <CheckSquareIcon className="ml-auto size-3.5 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <SlidersHorizontalIcon className="size-3.5" />
                    Advanced filters
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-52">
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => setInputValue(toggleSearchToken(inputValue, "later:true"))}
                    >
                      <Clock3Icon className="size-3.5" />
                      Later marks
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => setInputValue(toggleSearchToken(inputValue, "important:true"))}
                    >
                      <FlagIcon className="size-3.5" />
                      Important marks
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => setInputValue(toggleSearchToken(inputValue, "public:true"))}
                    >
                      <GlobeIcon className="size-3.5" />
                      Public marks
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => setInputValue(clearFlagTokens(inputValue))}
                    >
                      <XIcon className="size-3.5" />
                      Clear mark filters
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2" render={<Link to="/app/learn" />}>
                  <BookOpenIcon className="size-3.5" />
                  <span>Advanced Search</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => {
                    setIsHotkeysDialogOpen(true);
                  }}
                >
                  <Kbd>?</Kbd>
                  <span>Keyboard shortcuts</span>
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
          {foldersQuery.isLoading
            ? Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={`folder-skeleton-${index}`}
                  className="frappe-shimmer h-9 w-28 shrink-0 rounded-lg bg-muted/30"
                />
              ))
            : null}

          {!foldersQuery.isLoading ? (
            <button
              type="button"
              className={cn(
                MARKS_FOLDER_CHIP_CLASS,
                "bg-transparent hover:bg-muted/25",
                !activeFolderId && "bg-primary/10",
              )}
              aria-pressed={!activeFolderId}
              onClick={() => setSelectedFolderId(null)}
              onFocus={prefetchAllRows}
              onMouseEnter={prefetchAllRows}
            >
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">All</span>
            </button>
          ) : null}

          {!foldersQuery.isLoading
            ? folders.map((folder) => (
                <MarksFolderPickerChip
                  key={folder.id}
                  folder={folder}
                  isActive={activeFolderId === folder.id}
                  onSelect={() => {
                    setSelectedFolderId(folder.id);
                    if (folder.unseenCount > 0) {
                      markFolderSeenMutation.mutate(folder.id);
                    }
                  }}
                  onPrefetch={() => prefetchFolderRows(folder)}
                  pinFolderMutation={pinFolderMutation}
                  syncFolderMutation={syncFolderMutation}
                  markFolderSeenMutation={markFolderSeenMutation}
                  deleteFolderMutation={deleteFolderMutation}
                  onOpenRssSettings={() => openRssSettingsDialog(folder)}
                  onExportJson={() => exportFolderBookmarks(folder, "json")}
                  onExportCsv={() => exportFolderBookmarks(folder, "csv")}
                  onImport={() => promptImportBookmarks(folder.id)}
                  onDelete={() => deleteFolderMutation.mutate(folder.id)}
                />
              ))
            : null}

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-muted/10 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground">
              <PlusIcon className="size-3.5" />
              Live folder
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72" align="start">
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
                      <FolderSourceIcon folder={{ name: "", sourceType: option.sourceType }} />
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
        </div>

        <Dialog open={isHotkeysDialogOpen} onOpenChange={setIsHotkeysDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Keyboard shortcuts</DialogTitle>
              <DialogDescription>
                Move faster with hotkeys for folders, search modes, navigation, and quick input
                focus.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <span>Focus input</span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>/</Kbd>
                  <Kbd>Mod</Kbd>
                  <Kbd>Enter</Kbd>
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <span>Go to profile/settings</span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>Mod</Kbd>
                  <Kbd>,</Kbd>
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <span>Cycle search mode</span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>Alt</Kbd>
                  <Kbd>S</Kbd>
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <span>Search mode direct</span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>Alt</Kbd>
                  <Kbd>Shift</Kbd>
                  <Kbd>1</Kbd>
                  <span className="px-1 text-muted-foreground">/</span>
                  <Kbd>2</Kbd>
                  <span className="px-1 text-muted-foreground">/</span>
                  <Kbd>3</Kbd>
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <span>Folders (All + first 4)</span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>Alt</Kbd>
                  <Kbd>0-4</Kbd>
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <span>Open this dialog</span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>?</Kbd>
                </span>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
                Paste an RSS or Atom feed URL. The folder name is read from the feed channel and new
                items sync automatically. For suggested sources, open the{" "}
                <Link
                  to="/app/feeds"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Feeds
                </Link>{" "}
                page.
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
              setGithubRepoListSearch("");
              setGithubResourceType("all");
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add GitHub live folder</DialogTitle>
              <DialogDescription>
                Choose a repository from your connected account, or paste owner/repo manually.
              </DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={submitGitHubFolder}>
              {githubConnectionQuery.isLoading ? (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Checking GitHub connection...
                </p>
              ) : null}
              {githubConnectionQuery.isError ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                  Could not read GitHub connection state. You can still connect below.
                </p>
              ) : null}
              {githubReposQuery.data?.error ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                  {githubReposQuery.data.error}
                </p>
              ) : null}
              {hasGitHubConnection ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <Label htmlFor="github-repo-search" className="text-foreground">
                      Your repositories
                    </Label>
                    {githubReposQuery.isFetching && !githubReposQuery.isLoading ? (
                      <span className="text-xs text-muted-foreground">Refreshing…</span>
                    ) : null}
                  </div>
                  <Input
                    id="github-repo-search"
                    type="search"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Search owner/repo…"
                    className="h-9 rounded-md text-sm"
                    value={githubRepoListSearch}
                    disabled={githubReposQuery.isLoading}
                    onChange={(event) => setGithubRepoListSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                      }
                    }}
                  />
                  <div
                    role="listbox"
                    aria-label="Repositories"
                    className="max-h-56 overflow-y-auto rounded-xl border border-border/70 bg-muted/15 py-1 shadow-inner"
                  >
                    {githubReposQuery.isLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
                        <Loader2Icon className="size-5 animate-spin" />
                        Loading repositories…
                      </div>
                    ) : filteredGithubRepos.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {githubRepoListSearch.trim()
                          ? "No repositories match that search."
                          : "No repositories returned. Try manual entry below or reconnect with repo access."}
                      </p>
                    ) : (
                      filteredGithubRepos.map((repo) => {
                        const selected = githubRepoValue === repo.fullName;
                        return (
                          <button
                            key={repo.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                              selected
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-muted/70",
                            )}
                            onClick={() => {
                              setGithubRepoValue(repo.fullName);
                            }}
                          >
                            <span className="flex size-4 shrink-0 items-center justify-center">
                              {selected ? <CheckIcon className="size-3.5 opacity-90" /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[13px] leading-snug">
                              {repo.fullName}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  {!hasGitHubRepoScope ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Reconnect with{" "}
                      <span className="rounded bg-muted px-1 font-mono text-[11px]">repo</span>{" "}
                      scope to list private repositories and avoid API errors.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="github-repo" className="text-foreground">
                  Repository <span className="font-normal text-muted-foreground">(manual)</span>
                </Label>
                <Input
                  id="github-repo"
                  className="h-9 rounded-md text-sm"
                  placeholder="owner/repo"
                  value={githubRepoValue}
                  onChange={(event) => setGithubRepoValue(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Paste any repo you can access, or pick one from the list above.
                </p>
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium text-foreground">Stream</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["all", "issues", "pulls", "releases"] as const).map((resourceType) => (
                    <button
                      key={resourceType}
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground capitalize transition-colors hover:bg-muted hover:text-foreground aria-pressed:border-ring aria-pressed:bg-muted aria-pressed:text-foreground"
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
                {!githubConnectionQuery.isLoading && !hasGitHubConnection ? (
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
                    Connect GitHub (repo permission)
                  </button>
                ) : null}
                {!githubConnectionQuery.isLoading && hasGitHubConnection && !hasGitHubRepoScope ? (
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
                    disabled={connectGitHubMutation.isPending}
                    onClick={() => connectGitHubMutation.mutate()}
                  >
                    <SiGithub className="size-3.5" />
                    Reconnect with repo permission
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                  disabled={
                    createLiveFolderMutation.isPending ||
                    !githubRepoValue.trim() ||
                    githubConnectionQuery.isLoading
                  }
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
                  placeholder="reading list (use todo:plans for task list)"
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
          open={isRssSettingsDialogOpen}
          onOpenChange={(open) => {
            setIsRssSettingsDialogOpen(open);
            if (!open) {
              setSettingsFolderId(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>RSS sync settings</DialogTitle>
              <DialogDescription>
                Configure how often this feed syncs, how many items to fetch each sync, and how many
                recent RSS items to keep.
              </DialogDescription>
            </DialogHeader>
            <form className="grid gap-5" onSubmit={submitRssSettings}>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  Recommended defaults work well for most feeds. Lower intervals sync faster but may
                  increase API and background load.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rss-sync-interval">Sync interval (minutes)</Label>
                <Input
                  id="rss-sync-interval"
                  type="number"
                  min={5}
                  max={1440}
                  className="h-10 rounded-md text-sm"
                  value={rssSyncIntervalMinutesInput}
                  onChange={(event) => setRssSyncIntervalMinutesInput(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Minimum 5, maximum 1440 minutes.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rss-fetch-limit">Fetch limit per sync</Label>
                <Input
                  id="rss-fetch-limit"
                  type="number"
                  min={10}
                  max={500}
                  className="h-10 rounded-md text-sm"
                  value={rssFetchLimitInput}
                  onChange={(event) => setRssFetchLimitInput(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 10, maximum 500 items per run.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rss-keep-recent">Keep recent RSS items</Label>
                <Input
                  id="rss-keep-recent"
                  type="number"
                  min={20}
                  max={5000}
                  className="h-10 rounded-md text-sm"
                  value={rssKeepRecentCountInput}
                  onChange={(event) => setRssKeepRecentCountInput(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 20, maximum 5000 items retained in this folder.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsRssSettingsDialogOpen(false);
                    setSettingsFolderId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={configureRssSyncMutation.isPending || !settingsFolder}
                >
                  {configureRssSyncMutation.isPending ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : null}
                  {configureRssSyncMutation.isPending ? "Saving" : "Save settings"}
                </Button>
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

        <input
          ref={importBookmarksInputRef}
          type="file"
          accept=".json,.csv"
          className="hidden"
          onChange={onImportBookmarksFile}
        />

        {!isXFolderSelected && isSelectionMode ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
                allVisibleSelected
                  ? "border-primary/35 bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => {
                if (allVisibleSelected) {
                  setSelectedBookmarkIds([]);
                  return;
                }
                setSelectedBookmarkIds(visibleRows.map((row) => row.id));
              }}
              disabled={visibleRows.length === 0}
            >
              <CheckSquareIcon className="size-3.5" />
              {allVisibleSelected ? "Clear selection" : "Select all"}
            </button>
            <span className="text-muted-foreground">{selectedVisibleCount} selected in view</span>
            <DropdownMenu open={isSelectionExportOpen} onOpenChange={setIsSelectionExportOpen}>
              <DropdownMenuTrigger
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onMouseEnter={() => setIsSelectionExportOpen(true)}
              >
                <DownloadIcon className="size-3.5" />
                Export
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-44"
                onMouseLeave={() => setIsSelectionExportOpen(false)}
              >
                <DropdownMenuItem
                  disabled={selectedBookmarkIds.length === 0}
                  onClick={() => exportSelectedBookmarks("json")}
                >
                  <FileTextIcon className="size-4" />
                  Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={selectedBookmarkIds.length === 0}
                  onClick={() => exportSelectedBookmarks("csv")}
                >
                  <DownloadIcon className="size-4" />
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              disabled={selectedVisibleRows.length === 0}
              onClick={() => void copyManyBookmarkUrls(selectedVisibleRows.map((row) => row.url))}
            >
              <ClipboardIcon className="size-3.5" />
              Copy URLs
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              disabled={
                selectedVisibleRows.length === 0 || bulkUpdateBookmarkFlagsMutation.isPending
              }
              onClick={() =>
                bulkUpdateBookmarkFlagsMutation.mutate({
                  ids: selectedVisibleRows.map((row) => row.id),
                  changes: {
                    isImportant: !selectedVisibleRows.every((row) => row.isImportant),
                  },
                  successMessage: selectedVisibleRows.every((row) => row.isImportant)
                    ? "Unmarked important"
                    : "Marked important",
                })
              }
            >
              <FlagIcon className="size-3.5" />
              {selectedVisibleRows.every((row) => row.isImportant) ? "Unimportant" : "Important"}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              disabled={
                selectedVisibleRows.length === 0 || bulkUpdateBookmarkFlagsMutation.isPending
              }
              onClick={() =>
                bulkUpdateBookmarkFlagsMutation.mutate({
                  ids: selectedVisibleRows.map((row) => row.id),
                  changes: {
                    saveForLater: !selectedVisibleRows.every((row) => row.saveForLater),
                  },
                  successMessage: selectedVisibleRows.every((row) => row.saveForLater)
                    ? "Removed from later"
                    : "Saved for later",
                })
              }
            >
              <Clock3Icon className="size-3.5" />
              {selectedVisibleRows.every((row) => row.saveForLater) ? "Remove later" : "Later"}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              disabled={
                selectedVisibleRows.length === 0 || bulkUpdateBookmarkFlagsMutation.isPending
              }
              onClick={() =>
                bulkUpdateBookmarkFlagsMutation.mutate({
                  ids: selectedVisibleRows.map((row) => row.id),
                  changes: {
                    visibility: selectedVisibleRows.every((row) => row.visibility === "public")
                      ? "private"
                      : "public",
                  },
                  successMessage: selectedVisibleRows.every((row) => row.visibility === "public")
                    ? "Marked private"
                    : "Marked public",
                })
              }
            >
              <GlobeIcon className="size-3.5" />
              {selectedVisibleRows.every((row) => row.visibility === "public")
                ? "Private"
                : "Public"}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/35 bg-background px-2.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              disabled={selectedVisibleRows.length === 0 || deleteBookmarksBulkMutation.isPending}
              onClick={() => deleteBookmarksBulkMutation.mutate(selectedBookmarkIds)}
            >
              {deleteBookmarksBulkMutation.isPending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
              Delete selected
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedBookmarkIds([]);
              }}
            >
              Done
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)_10rem] border-b border-border/60 pb-2.5 text-sm text-muted-foreground">
          <p>Marks</p>
          <p
            className="justify-self-end text-right text-sm font-medium text-foreground/80"
            style={{ width: CREATED_AT_COL_W }}
          >
            Created
          </p>
        </div>

        <ul ref={virtualListRef} className="divide-y divide-border/60">
          {isLoadingRows || (isRefreshingRows && totalVisibleRows === 0)
            ? Array.from({ length: 6 }).map((_, index) => (
                <li
                  key={`skeleton-${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_10rem] items-start gap-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="frappe-shimmer mt-0.5 size-4 shrink-0 rounded-sm bg-muted/65" />
                    <div className="min-w-0 flex-1">
                      <div className="frappe-shimmer h-4 w-3/5 rounded-md bg-muted/65" />
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="frappe-shimmer h-3 w-24 rounded-md bg-muted/55" />
                      </div>
                    </div>
                  </div>
                  <div className="self-center justify-self-end" style={{ width: CREATED_AT_COL_W }}>
                    <div className="frappe-shimmer h-3.5 w-full rounded-md bg-muted/55" />
                  </div>
                </li>
              ))
            : null}

          {!isLoadingRows && isXFolderSelected && xBookmarksQuery.data?.error ? (
            <li className="px-2 py-10 text-center">
              <p className="text-sm text-foreground">{xBookmarksQuery.data.error}</p>
              {xBookmarksQuery.data.status ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  X API status {xBookmarksQuery.data.status}
                </p>
              ) : null}
            </li>
          ) : null}

          {!isLoadingRows && displayedRowCount > 0 && virtualPaddingTop > 0 ? (
            <li
              aria-hidden="true"
              className="pointer-events-none border-0"
              style={{ height: virtualPaddingTop }}
            />
          ) : null}

          {!isLoadingRows &&
            isXFolderSelected &&
            !xBookmarksQuery.data?.error &&
            virtualDisplayedXRows.map((item) => {
              const useXAnchorRow = isSafeExternalBookmarkHref(item.url);
              return (
                <li key={item.id} className="py-1">
                  <ContextMenu>
                    <ContextMenuTrigger
                      className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      onMouseEnter={() => setHoveredBookmarkId(item.id)}
                      onFocus={() => setHoveredBookmarkId(item.id)}
                    >
                      <BookmarkRowInteractive
                        useAnchor={useXAnchorRow}
                        href={item.url}
                        className={cn(
                          "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_10rem] items-start gap-3 rounded-md px-2 py-2 text-left transition-all duration-150 hover:-translate-y-px hover:bg-muted/40 hover:shadow-sm hover:shadow-foreground/5 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-muted/50",
                          useXAnchorRow && "text-foreground visited:text-muted-foreground",
                        )}
                        onButtonClick={() => openExternalUrl(item.url)}
                        onButtonKeyDown={(event) =>
                          handleRowKeyDown(event, () => openExternalUrl(item.url))
                        }
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground">
                            <SiX className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <span
                              className={cn(
                                "block truncate text-sm",
                                useXAnchorRow ? "text-inherit" : "text-foreground",
                              )}
                            >
                              {item.title}
                            </span>
                            {search.trim() ? (
                              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    "truncate text-xs",
                                    useXAnchorRow
                                      ? "text-inherit opacity-90"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {item.username ? `@${item.username}` : (item.authorName ?? "X")}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <CreatedAtCell iso={item.createdAt} inheritLinkTint={useXAnchorRow} />
                      </BookmarkRowInteractive>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-52">
                      <ContextMenuItem onClick={() => void copyBookmarkUrl(item.url)}>
                        <ClipboardIcon />
                        Copy URL
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLinkIcon />
                        Open on X
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </li>
              );
            })}

          {!isLoadingRows &&
            !isXFolderSelected &&
            virtualDisplayedVisibleRows.map((item) => {
              const isTodoBookmark = isTodoFolderName(item.folderName);
              const isLink = item.contentType === "link";
              const canSubmitToHackerNews = isLink && !isHackerNewsUrl(item.url);
              const host = isLink ? getHostFromUrl(item.url) : "";
              const redditSubreddit = isLink ? getRedditSubredditFromUrl(item.url) : "";
              const displayTitle =
                item.title || (isLink ? getDisplayLabelFromUrl(item.url) : item.url);
              const rowTitle = redditSubreddit
                ? `${redditSubreddit} / ${displayTitle}`
                : displayTitle;
              const isSearching = Boolean(search.trim());
              const secondaryLabel = isSearching ? host || item.tag : "";
              const showMatchScore =
                searchMode === "semantic" && isSearching && typeof item.matchScore === "number";
              const primaryFaviconUrl = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : "";
              const fallbackFaviconUrl = host
                ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`
                : "";
              const useAnchorRow =
                isLink &&
                isSafeExternalBookmarkHref(item.url) &&
                !isTodoFolderSelected &&
                !isSelectionMode;
              const bookmarkRowInteractiveClass = cn(
                "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_10rem] items-start gap-3 rounded-md px-2 py-2 text-left transition-all duration-150 hover:-translate-y-px hover:bg-muted/40 hover:shadow-sm hover:shadow-foreground/5 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-muted/50",
                isTodoFolderSelected ? "border border-border/60 bg-muted/20" : "",
                useAnchorRow && "text-foreground visited:text-muted-foreground",
              );

              return (
                <li key={item.id} className="py-1">
                  <ContextMenu>
                    <ContextMenuTrigger className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                      <BookmarkRowInteractive
                        useAnchor={useAnchorRow}
                        href={item.url}
                        className={bookmarkRowInteractiveClass}
                        onMouseEnter={() => setHoveredBookmarkId(item.id)}
                        onFocus={() => setHoveredBookmarkId(item.id)}
                        onButtonClick={() => {
                          if (isSelectionMode) {
                            setSelectedBookmarkIds((current) => {
                              if (current.includes(item.id)) {
                                return current.filter((id) => id !== item.id);
                              }
                              return [...current, item.id];
                            });
                            return;
                          }
                          if (isTodoFolderSelected) {
                            updateBookmarkFlagsMutation.mutate({
                              id: item.id,
                              isCompleted: !item.isCompleted,
                            });
                            return;
                          }
                          activateBookmarkRow(item);
                        }}
                        onButtonKeyDown={(event) =>
                          handleRowKeyDown(event, () => {
                            if (isSelectionMode) {
                              setSelectedBookmarkIds((current) => {
                                if (current.includes(item.id)) {
                                  return current.filter((id) => id !== item.id);
                                }
                                return [...current, item.id];
                              });
                              return;
                            }
                            if (isTodoFolderSelected) {
                              updateBookmarkFlagsMutation.mutate({
                                id: item.id,
                                isCompleted: !item.isCompleted,
                              });
                              return;
                            }
                            activateBookmarkRow(item);
                          })
                        }
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          {isSelectionMode ? (
                            <input
                              type="checkbox"
                              aria-label="Select bookmark"
                              className="mt-0.5 size-3.5 shrink-0 rounded-[4px] border border-muted-foreground/40 bg-background accent-foreground/80"
                              checked={selectedBookmarkIdSet.has(item.id)}
                              onChange={(event) => {
                                event.stopPropagation();
                                setSelectedBookmarkIds((current) => {
                                  if (current.includes(item.id)) {
                                    return current.filter((id) => id !== item.id);
                                  }
                                  return [...current, item.id];
                                });
                              }}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : null}
                          {isTodoFolderSelected ? (
                            <input
                              type="checkbox"
                              aria-label="Mark todo as complete"
                              className="mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-md border-2 border-muted-foreground/30 bg-background shadow-sm transition-colors checked:border-primary/55 checked:bg-primary/35 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                              checked={item.isCompleted}
                              onChange={(event) => {
                                event.stopPropagation();
                                updateBookmarkFlagsMutation.mutate({
                                  id: item.id,
                                  isCompleted: event.target.checked,
                                });
                              }}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : null}
                          {!isTodoFolderSelected && !isTodoBookmark && isLink && host ? (
                            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-white/90 ring-1 ring-black/5 dark:bg-white dark:ring-white/15">
                              <img
                                src={primaryFaviconUrl}
                                alt=""
                                className="size-3 rounded-[2px]"
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
                            </span>
                          ) : !isTodoFolderSelected ? (
                            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] text-muted-foreground">
                              {isTodoBookmark ? (
                                <CheckSquareIcon className="size-3" />
                              ) : isLink ? (
                                item.tag.slice(0, 1).toUpperCase()
                              ) : (
                                <FileTextIcon className="size-3" />
                              )}
                            </span>
                          ) : null}
                          <div className="min-w-0">
                            {isLink ? (
                              <span
                                className={cn(
                                  "block truncate text-sm",
                                  useAnchorRow ? "text-inherit" : "text-foreground",
                                  isTodoFolderSelected &&
                                    item.isCompleted &&
                                    "line-through opacity-70",
                                )}
                              >
                                {rowTitle}
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  "block max-w-full truncate text-sm",
                                  useAnchorRow ? "text-inherit" : "text-foreground",
                                  isTodoFolderSelected &&
                                    item.isCompleted &&
                                    "line-through opacity-70",
                                )}
                              >
                                {rowTitle}
                              </span>
                            )}
                            {secondaryLabel || showMatchScore ? (
                              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                {secondaryLabel ? (
                                  <span
                                    className={cn(
                                      "truncate text-xs",
                                      useAnchorRow
                                        ? "text-inherit opacity-90"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {secondaryLabel}
                                  </span>
                                ) : null}
                                {showMatchScore ? (
                                  <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border bg-muted/60 px-2 text-[11px] font-medium text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                    {item.matchScore === 100
                                      ? "best match"
                                      : `${item.matchScore}% match`}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {item.saveForLater ||
                            item.isImportant ||
                            item.visibility === "public" ||
                            isTodoBookmark ||
                            (isTodoFolderSelected && item.isCompleted) ? (
                              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                                {isTodoFolderSelected && item.isCompleted ? (
                                  <span className="inline-flex h-4 items-center rounded-full border border-primary/35 bg-primary/10 px-1.5 text-[10px] text-primary/90">
                                    Done
                                  </span>
                                ) : null}
                                {isTodoBookmark ? (
                                  <span className="inline-flex h-4 items-center rounded-full border bg-muted/60 px-1.5 text-[10px] text-muted-foreground">
                                    Todo
                                  </span>
                                ) : null}
                                {item.saveForLater ? (
                                  <span className="inline-flex h-4 items-center rounded-full border bg-muted/60 px-1.5 text-[10px] text-muted-foreground">
                                    Later
                                  </span>
                                ) : null}
                                {item.isImportant ? (
                                  <span className="inline-flex h-4 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                                    Important
                                  </span>
                                ) : null}
                                {item.visibility === "public" ? (
                                  <span className="inline-flex h-4 items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 text-[10px] text-sky-700 dark:text-sky-300">
                                    Public
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <CreatedAtCell iso={item.createdAt} inheritLinkTint={useAnchorRow} />
                      </BookmarkRowInteractive>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-60 rounded-2xl border-border/60 p-1">
                      {!isTodoBookmark ? (
                        <ContextMenuItem
                          className="py-2"
                          onClick={() => void copyBookmarkUrl(item.url)}
                        >
                          <ClipboardIcon />
                          {isLink ? "Copy" : "Copy text"}
                          <ContextMenuShortcut>C</ContextMenuShortcut>
                        </ContextMenuItem>
                      ) : null}
                      <ContextMenuItem
                        className="py-2"
                        onClick={() => {
                          setRenamingBookmark(item);
                          setBookmarkTitleValue(displayTitle);
                        }}
                      >
                        <PencilIcon />
                        Rename
                        <ContextMenuShortcut>R</ContextMenuShortcut>
                      </ContextMenuItem>
                      {isLink ? (
                        <ContextMenuItem
                          className="py-2"
                          onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                        >
                          <ExternalLinkIcon />
                          Open Link
                        </ContextMenuItem>
                      ) : null}
                      {canSubmitToHackerNews ? (
                        <ContextMenuItem
                          className="py-2"
                          onClick={() => submitToHackerNews(item.url, item.title ?? displayTitle)}
                        >
                          <UploadIcon />
                          Submit to Hacker News
                        </ContextMenuItem>
                      ) : null}
                      {isLink ? (
                        <ContextMenuItem
                          className="py-2"
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
                      ) : null}
                      <ContextMenuItem className="py-2" disabled>
                        <SparklesIcon />
                        Embedding: {formatEmbeddingStatus(item.embeddingStatus)}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="py-2"
                        disabled={
                          requestBookmarkEmbeddingMutation.isPending &&
                          requestBookmarkEmbeddingMutation.variables?.id === item.id
                        }
                        onClick={() =>
                          requestBookmarkEmbeddingMutation.mutate({
                            id: item.id,
                            force: true,
                          })
                        }
                      >
                        {requestBookmarkEmbeddingMutation.isPending &&
                        requestBookmarkEmbeddingMutation.variables?.id === item.id ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <SparklesIcon />
                        )}
                        Embed now
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="py-2"
                        disabled={!isTodoFolderSelected}
                        onClick={() =>
                          updateBookmarkFlagsMutation.mutate({
                            id: item.id,
                            isCompleted: !item.isCompleted,
                          })
                        }
                      >
                        <CheckSquareIcon />
                        {item.isCompleted ? "Mark as not done" : "Mark as done"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="py-2"
                        onClick={() =>
                          updateBookmarkFlagsMutation.mutate({
                            id: item.id,
                            saveForLater: !item.saveForLater,
                          })
                        }
                      >
                        <Clock3Icon />
                        {item.saveForLater ? "Remove from save later" : "Save for later"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="py-2"
                        onClick={() =>
                          updateBookmarkFlagsMutation.mutate({
                            id: item.id,
                            isImportant: !item.isImportant,
                          })
                        }
                      >
                        <FlagIcon />
                        {item.isImportant ? "Unmark important" : "Mark as important"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="py-2"
                        onClick={() =>
                          updateBookmarkFlagsMutation.mutate({
                            id: item.id,
                            visibility: item.visibility === "public" ? "private" : "public",
                          })
                        }
                      >
                        {item.visibility === "public" ? <LockIcon /> : <GlobeIcon />}
                        {item.visibility === "public" ? "Make private" : "Make public "}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="py-2"
                        onClick={() => {
                          setIsSelectionMode(true);
                          setSelectedBookmarkIds((current) => {
                            if (current.includes(item.id)) {
                              return current;
                            }
                            return [...current, item.id];
                          });
                        }}
                      >
                        <CheckSquareIcon />
                        Select
                        <ContextMenuShortcut>S</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="py-2"
                        variant="destructive"
                        disabled={deleteBookmarkMutation.isPending}
                        onClick={() => deleteBookmarkMutation.mutate(item.id)}
                      >
                        {deleteBookmarkMutation.isPending ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon />
                        )}
                        Delete
                        <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </li>
              );
            })}

          {!isLoadingRows && displayedRowCount > 0 && virtualPaddingBottom > 0 ? (
            <li
              aria-hidden="true"
              className="pointer-events-none border-0"
              style={{ height: virtualPaddingBottom }}
            />
          ) : null}

          {!isLoadingRows && hasMoreRowsWithPagination ? (
            <li
              ref={loadMoreRef}
              className={hasMoreRows || isRefreshingRows ? "flex justify-center px-2 py-4" : "h-px"}
            >
              {hasMoreRows || isRefreshingRows ? (
                <span className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs text-muted-foreground shadow-sm shadow-foreground/5">
                  {isRefreshingRows ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  {isRefreshingRows ? "Loading more" : "Scroll to load more"}
                </span>
              ) : null}
            </li>
          ) : null}

          {!isLoadingRows && !xBookmarksQuery.data?.error && totalVisibleRows === 0 ? (
            <li className="px-2 py-10 text-center text-sm text-muted-foreground">
              {isXFolderSelected
                ? "No X bookmarks found."
                : isGitHubFolderSelected
                  ? "No GitHub items yet. Sync may still be running, or nothing matched this folder."
                  : "No bookmarks yet."}
            </li>
          ) : null}
        </ul>
      </div>
    </main>
  );
}

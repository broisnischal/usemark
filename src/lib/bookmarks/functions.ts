import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookmark, bookmarkFolder, user } from "@/lib/db/schema";

import { cosineSimilarity, embedText, getEmbeddingModelName, toEmbeddingText } from "./embeddings";
import { fetchBookmarkMetadata } from "./metadata";

export type BookmarkContentType = "link" | "text";
export type BookmarkFolderSourceType = "local" | "todo" | "rss" | "github" | "x" | "reddit";

export interface BookmarkRecord {
  id: string;
  contentType: BookmarkContentType;
  url: string;
  title: string | null;
  tag: string;
  saveForLater: boolean;
  isImportant: boolean;
  isCompleted: boolean;
  visibility: "private" | "public";
  folderId: string;
  folderName: string;
  embeddingStatus: string;
  matchScore?: number;
  createdAt: string;
}

export interface BookmarkFolderRecord {
  id: string;
  name: string;
  sourceType: BookmarkFolderSourceType;
  syncEnabled: boolean;
  isPinned: boolean;
  visibility: "private" | "public";
  externalAccountId: string | null;
  externalResourceId: string | null;
  unseenCount: number;
  lastSyncedAt: string | null;
  syncIntervalMinutes: number;
  rssFetchLimit: number;
  rssKeepRecentCount: number;
}

interface CreateBookmarkInput {
  url: string;
  note?: string;
  folder?: string;
  category?: string;
}

interface CreateBookmarksBatchInput {
  url: string;
  note?: string;
  folder?: string;
  category?: string;
  folderId?: string;
  title?: string | null;
  sourceItemId?: string | null;
  seenAt?: Date | null;
  createdAt?: Date | string;
  tag?: string;
  contentType?: BookmarkContentType;
}

interface CreateBookmarkFolderInput {
  name: string;
  sourceType?: BookmarkFolderSourceType;
  syncEnabled?: boolean;
  externalAccountId?: string | null;
  externalResourceId?: string | null;
  visibility?: "private" | "public";
  syncIntervalMinutes?: number;
  rssFetchLimit?: number;
  rssKeepRecentCount?: number;
}

interface UpdateRssFolderSettingsInput {
  syncIntervalMinutes?: number;
  rssFetchLimit?: number;
  rssKeepRecentCount?: number;
}

interface SearchBookmarkInput {
  query: string;
}

interface RssItem {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
}

const RSS_MAX_ACTIVE_ITEMS = 100;
const RSS_MIN_FETCH_LIMIT = 10;
const RSS_MAX_FETCH_LIMIT = 500;
const RSS_MIN_KEEP_RECENT_COUNT = 20;
const RSS_MAX_KEEP_RECENT_COUNT = 5000;
const RSS_MIN_SYNC_INTERVAL_MINUTES = 5;
const RSS_MAX_SYNC_INTERVAL_MINUTES = 1440;
const REDDIT_RSS_ITEM_LIMIT = 100;
// Keep this conservative for D1 in local/worker runtimes.
// New bookmark columns increase bound parameters per row quickly.
const D1_SQL_VARIABLE_LIMIT = 100;
const BOOKMARK_INSERT_BOUND_VALUE_COUNT = 21;
const RSS_INSERT_CHUNK_SIZE = Math.max(
  1,
  Math.floor(D1_SQL_VARIABLE_LIMIT / BOOKMARK_INSERT_BOUND_VALUE_COUNT),
);
const IMPORT_INSERT_CHUNK_SIZE = RSS_INSERT_CHUNK_SIZE;

function inferContentType(value: string): BookmarkContentType {
  const trimmed = value.trim();
  if (!trimmed) {
    return "text";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "link" : "text";
  } catch {
    const maybeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed);
    return maybeDomain ? "link" : "text";
  }
}

function normalizeBookmarkContent(value: string) {
  const trimmed = value.trim();
  const contentType = inferContentType(trimmed);

  if (contentType === "text") {
    return { content: trimmed, contentType };
  }

  try {
    const parsed = new URL(trimmed);
    return { content: parsed.toString(), contentType };
  } catch {
    return { content: `https://${trimmed}`, contentType };
  }
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SEMANTIC_ALIASES: Record<string, string[]> = {
  keyboard: ["hotkey", "hotkeys", "shortcut", "shortcuts", "keybinding", "keybindings"],
  hotkey: ["keyboard", "shortcut", "keybinding"],
  shortcut: ["keyboard", "hotkey", "keybinding"],
  keybinding: ["keyboard", "hotkey", "shortcut", "tanstack"],
  tanstack: ["router", "query", "start", "hotkeys", "keybinding"],
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function expandQueryWithAliases(query: string) {
  const tokens = tokenize(query);
  const expandedTokens = new Set(tokens);
  for (const token of tokens) {
    const aliases = SEMANTIC_ALIASES[token] ?? [];
    for (const alias of aliases) {
      expandedTokens.add(alias);
    }
  }
  return [...expandedTokens].join(" ").trim();
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function readXmlTag(source: string, tagName: string) {
  const match = source.match(
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"),
  );
  return match ? decodeXmlEntities(match[1] ?? "") : "";
}

function getRssChannelName(xml: string) {
  const channelMatch = xml.match(/<channel\b[\s\S]*?<\/channel>/i);
  const channelXml = channelMatch?.[0] ?? xml;
  return readXmlTag(channelXml, "title");
}

function getRssFetchUrl(feedUrl: string) {
  try {
    const parsed = new URL(feedUrl);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const isRedditRssFeed =
      host === "reddit.com" &&
      (parsed.pathname.endsWith(".rss") || parsed.pathname.endsWith(".atom"));

    if (isRedditRssFeed && !parsed.searchParams.has("limit")) {
      parsed.searchParams.set("limit", String(REDDIT_RSS_ITEM_LIMIT));
      return parsed.toString();
    }
  } catch {
    return feedUrl;
  }

  return feedUrl;
}

export async function fetchRssChannelName(feedUrl: string) {
  const response = await fetch(getRssFetchUrl(feedUrl), {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "UseMarkBot/1.0 (+live folder discovery)",
    },
  });

  if (!response.ok) {
    throw new Error("Could not fetch RSS feed.");
  }

  const xml = await response.text();
  return getRssChannelName(xml) || getFeedNameFromUrl(feedUrl);
}

function readXmlLink(source: string) {
  const rssLink = readXmlTag(source, "link");
  if (rssLink) {
    return rssLink;
  }

  const atomHref = source.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] ?? "";
  return decodeXmlEntities(atomHref);
}

function parseRssItems(xml: string, limit: number = RSS_MAX_ACTIVE_ITEMS) {
  const itemMatches = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)];
  const seenItemIds = new Set<string>();

  return itemMatches
    .reduce<RssItem[]>((items, match) => {
      const itemXml = match[0];
      const title = readXmlTag(itemXml, "title") || "Untitled";
      const url = readXmlLink(itemXml);
      if (!url) {
        return items;
      }

      const guid = readXmlTag(itemXml, "guid") || readXmlTag(itemXml, "id") || url;
      if (seenItemIds.has(guid)) {
        return items;
      }

      seenItemIds.add(guid);
      const publishedValue =
        readXmlTag(itemXml, "pubDate") ||
        readXmlTag(itemXml, "published") ||
        readXmlTag(itemXml, "updated");
      const publishedAt = publishedValue ? new Date(publishedValue) : null;

      items.push({
        id: guid,
        title,
        url,
        publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null,
      });

      return items;
    }, [])
    .slice(0, Math.max(1, limit));
}

function getUrlHost(urlValue: string) {
  try {
    return new URL(urlValue).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function getTagFromUrl(urlValue: string) {
  const host = getUrlHost(urlValue);
  if (!host) {
    return "other";
  }
  return host.split(".")[0] ?? "other";
}

function getTagFromContent(content: string, contentType: BookmarkContentType) {
  if (contentType === "text") {
    return "text";
  }

  return getTagFromUrl(content);
}

function getFeedNameFromUrl(urlValue: string) {
  try {
    return new URL(urlValue).hostname.replace(/^www\./, "");
  } catch {
    return "RSS";
  }
}

function normalizeFolderName(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "default";
}

function getLocalFolderId(userId: string, folderName: string) {
  return `local:${userId}:${encodeURIComponent(folderName)}`;
}

function normalizeFolderSourceType(value: string | undefined): BookmarkFolderSourceType {
  if (
    value === "todo" ||
    value === "rss" ||
    value === "github" ||
    value === "x" ||
    value === "reddit"
  ) {
    return value;
  }

  return "local";
}

function normalizeFolderVisibility(value: string | undefined) {
  return value === "public" ? "public" : "private";
}

function normalizeRssSyncIntervalMinutes(value: number | undefined) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 30;
  return Math.max(
    RSS_MIN_SYNC_INTERVAL_MINUTES,
    Math.min(RSS_MAX_SYNC_INTERVAL_MINUTES, Math.floor(numericValue)),
  );
}

function normalizeRssFetchLimit(value: number | undefined) {
  const numericValue =
    typeof value === "number" && Number.isFinite(value) ? value : RSS_MAX_ACTIVE_ITEMS;
  return Math.max(RSS_MIN_FETCH_LIMIT, Math.min(RSS_MAX_FETCH_LIMIT, Math.floor(numericValue)));
}

function normalizeRssKeepRecentCount(value: number | undefined) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 500;
  return Math.max(
    RSS_MIN_KEEP_RECENT_COUNT,
    Math.min(RSS_MAX_KEEP_RECENT_COUNT, Math.floor(numericValue)),
  );
}

const MONTH_INDEX_BY_NAME = new Map([
  ["january", 0],
  ["jan", 0],
  ["february", 1],
  ["feb", 1],
  ["march", 2],
  ["mar", 2],
  ["april", 3],
  ["apr", 3],
  ["may", 4],
  ["june", 5],
  ["jun", 5],
  ["july", 6],
  ["jul", 6],
  ["august", 7],
  ["aug", 7],
  ["september", 8],
  ["sep", 8],
  ["sept", 8],
  ["october", 9],
  ["oct", 9],
  ["november", 10],
  ["nov", 10],
  ["december", 11],
  ["dec", 11],
] as const);

function getEndOfDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getMonthDateRange(monthIndex: number, year: number, day?: number) {
  if (typeof day === "number") {
    const start = new Date(year, monthIndex, day);
    if (start.getMonth() !== monthIndex || start.getDate() !== day) {
      return null;
    }

    start.setHours(0, 0, 0, 0);
    return { start, end: getEndOfDay(start) };
  }

  const start = new Date(year, monthIndex, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function ensureFolderForUser(
  userId: string,
  folderName?: string,
  input?: Omit<CreateBookmarkFolderInput, "name">,
) {
  const normalizedName = normalizeFolderName(folderName);
  const sourceType = normalizeFolderSourceType(input?.sourceType);

  const existing = await db
    .select()
    .from(bookmarkFolder)
    .where(
      sourceType === "local" || sourceType === "todo"
        ? and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.name, normalizedName))
        : and(
            eq(bookmarkFolder.userId, userId),
            eq(bookmarkFolder.sourceType, sourceType),
            eq(bookmarkFolder.externalResourceId, input?.externalResourceId?.trim() ?? ""),
          ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (existing) {
    return existing;
  }

  const folder = {
    id:
      sourceType === "local" || sourceType === "todo"
        ? getLocalFolderId(userId, normalizedName)
        : crypto.randomUUID(),
    userId,
    name: normalizedName,
    sourceType,
    syncEnabled: input?.syncEnabled ?? (sourceType !== "local" && sourceType !== "todo"),
    isPinned: false,
    visibility: normalizeFolderVisibility(input?.visibility),
    externalAccountId: input?.externalAccountId ?? null,
    externalResourceId: input?.externalResourceId?.trim() || null,
    unseenCount: 0,
    lastSyncedAt: null,
    syncIntervalMinutes: normalizeRssSyncIntervalMinutes(input?.syncIntervalMinutes),
    rssFetchLimit: normalizeRssFetchLimit(input?.rssFetchLimit),
    rssKeepRecentCount: normalizeRssKeepRecentCount(input?.rssKeepRecentCount),
  } satisfies typeof bookmarkFolder.$inferInsert;

  if (sourceType === "local" || sourceType === "todo") {
    try {
      await db.insert(bookmarkFolder).values(folder);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("UNIQUE constraint failed") && !message.includes("constraint failed")) {
        throw error;
      }
    }

    const insertedOrExisting = await db
      .select()
      .from(bookmarkFolder)
      .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.name, normalizedName)))
      .limit(1)
      .then((rows) => rows[0]);

    return insertedOrExisting ?? folder;
  }

  await db.insert(bookmarkFolder).values(folder);

  const insertedOrExisting = await db
    .select()
    .from(bookmarkFolder)
    .where(
      and(
        eq(bookmarkFolder.userId, userId),
        eq(bookmarkFolder.sourceType, sourceType),
        eq(bookmarkFolder.externalResourceId, input?.externalResourceId?.trim() ?? ""),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  return insertedOrExisting ?? folder;
}

export async function listBookmarkFoldersForUser(userId: string) {
  await ensureFolderForUser(userId, "default");

  const rows = await db
    .select({
      id: bookmarkFolder.id,
      name: bookmarkFolder.name,
      sourceType: bookmarkFolder.sourceType,
      syncEnabled: bookmarkFolder.syncEnabled,
      isPinned: bookmarkFolder.isPinned,
      visibility: bookmarkFolder.visibility,
      externalAccountId: bookmarkFolder.externalAccountId,
      externalResourceId: bookmarkFolder.externalResourceId,
      unseenCount: bookmarkFolder.unseenCount,
      lastSyncedAt: bookmarkFolder.lastSyncedAt,
      syncIntervalMinutes: bookmarkFolder.syncIntervalMinutes,
      rssFetchLimit: bookmarkFolder.rssFetchLimit,
      rssKeepRecentCount: bookmarkFolder.rssKeepRecentCount,
    })
    .from(bookmarkFolder)
    .where(eq(bookmarkFolder.userId, userId))
    .orderBy(desc(bookmarkFolder.isPinned), bookmarkFolder.name);

  return rows.map((row) => ({
    ...row,
    sourceType: normalizeFolderSourceType(row.sourceType),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    syncIntervalMinutes: row.syncIntervalMinutes,
    rssFetchLimit: row.rssFetchLimit,
    rssKeepRecentCount: row.rssKeepRecentCount,
  })) satisfies BookmarkFolderRecord[];
}

export async function createBookmarkFolderForUser(
  userId: string,
  input: CreateBookmarkFolderInput,
) {
  const folder = await ensureFolderForUser(
    userId,
    input.name ||
      (input.sourceType === "rss"
        ? getFeedNameFromUrl(input.externalResourceId ?? "")
        : input.name),
    input,
  );
  return {
    id: folder.id,
    name: folder.name,
    sourceType: normalizeFolderSourceType(folder.sourceType),
    syncEnabled: folder.syncEnabled,
    isPinned: folder.isPinned,
    visibility: normalizeFolderVisibility(folder.visibility),
    externalAccountId: folder.externalAccountId,
    externalResourceId: folder.externalResourceId,
    unseenCount: folder.unseenCount,
    lastSyncedAt: folder.lastSyncedAt?.toISOString() ?? null,
    syncIntervalMinutes: folder.syncIntervalMinutes,
    rssFetchLimit: folder.rssFetchLimit,
    rssKeepRecentCount: folder.rssKeepRecentCount,
  } satisfies BookmarkFolderRecord;
}

export async function updateRssFolderSettingsForUser(
  userId: string,
  folderId: string,
  input: UpdateRssFolderSettingsInput,
) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    throw new Error("Folder id is required.");
  }

  const existing = await db
    .select()
    .from(bookmarkFolder)
    .where(
      and(
        eq(bookmarkFolder.userId, userId),
        eq(bookmarkFolder.id, normalizedFolderId),
        eq(bookmarkFolder.sourceType, "rss"),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return null;
  }

  await db
    .update(bookmarkFolder)
    .set({
      syncIntervalMinutes: normalizeRssSyncIntervalMinutes(input.syncIntervalMinutes),
      rssFetchLimit: normalizeRssFetchLimit(input.rssFetchLimit),
      rssKeepRecentCount: normalizeRssKeepRecentCount(input.rssKeepRecentCount),
    })
    .where(eq(bookmarkFolder.id, normalizedFolderId));

  const updated = await db
    .select()
    .from(bookmarkFolder)
    .where(eq(bookmarkFolder.id, normalizedFolderId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!updated) {
    return null;
  }

  return {
    id: updated.id,
    name: updated.name,
    sourceType: normalizeFolderSourceType(updated.sourceType),
    syncEnabled: updated.syncEnabled,
    isPinned: updated.isPinned,
    visibility: normalizeFolderVisibility(updated.visibility),
    externalAccountId: updated.externalAccountId,
    externalResourceId: updated.externalResourceId,
    unseenCount: updated.unseenCount,
    lastSyncedAt: updated.lastSyncedAt?.toISOString() ?? null,
    syncIntervalMinutes: updated.syncIntervalMinutes,
    rssFetchLimit: updated.rssFetchLimit,
    rssKeepRecentCount: updated.rssKeepRecentCount,
  } satisfies BookmarkFolderRecord;
}

function parseRelativeDateRange(query: string) {
  const lowered = query.toLowerCase();
  const now = new Date();

  if (lowered.includes("today")) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start, end: now };
  }

  if (lowered.includes("yesterday")) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const dayMatch = lowered.match(/(\d+)\s+days?\s+ago/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
      return { start, end: getEndOfDay(start) };
    }
  }

  const explicitYearMatch = lowered.match(/\b(20\d{2}|19\d{2})\b/);
  const parsedYear = explicitYearMatch ? Number(explicitYearMatch[1]) : now.getFullYear();

  for (const [monthName, monthIndex] of MONTH_INDEX_BY_NAME) {
    const monthDayMatch =
      lowered.match(new RegExp(`\\b${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)) ??
      lowered.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}\\b`));

    if (monthDayMatch?.[1]) {
      const day = Number(monthDayMatch[1]);
      if (Number.isFinite(day)) {
        return getMonthDateRange(monthIndex, parsedYear, day);
      }
    }

    if (new RegExp(`\\b${monthName}\\b`).test(lowered)) {
      return getMonthDateRange(monthIndex, parsedYear);
    }
  }

  return null;
}

function toBookmarkRecord(row: {
  id: string;
  contentType: BookmarkContentType;
  url: string;
  title: string | null;
  tag: string;
  saveForLater: boolean;
  isImportant: boolean;
  isCompleted: boolean;
  visibility: "private" | "public";
  folderId: string;
  folderName: string;
  embeddingStatus: string;
  matchScore?: number;
  createdAt: Date;
}): BookmarkRecord {
  return {
    id: row.id,
    contentType: row.contentType,
    url: row.url,
    title: row.title,
    tag: row.tag,
    saveForLater: row.saveForLater,
    isImportant: row.isImportant,
    isCompleted: row.isCompleted,
    visibility: row.visibility,
    folderId: row.folderId,
    folderName: row.folderName,
    embeddingStatus: row.embeddingStatus,
    matchScore: row.matchScore,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBookmarksForUser(
  userId: string,
  input?: { folderId?: string | null; limit?: number | null },
) {
  await ensureFolderForUser(userId, "default");
  const normalizedFolderId = input?.folderId?.trim() ?? "";
  const normalizedLimit =
    typeof input?.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.max(1, Math.min(500, Math.floor(input.limit)))
      : null;

  const baseQuery = db
    .select()
    .from(bookmark)
    .innerJoin(bookmarkFolder, eq(bookmark.folderId, bookmarkFolder.id))
    .where(
      normalizedFolderId
        ? and(eq(bookmark.userId, userId), eq(bookmark.folderId, normalizedFolderId))
        : eq(bookmark.userId, userId),
    )
    .orderBy(desc(bookmark.createdAt));
  const rows = normalizedLimit ? await baseQuery.limit(normalizedLimit) : await baseQuery;

  return rows.map((row) =>
    toBookmarkRecord({
      id: row.bookmark.id,
      contentType: row.bookmark.contentType,
      url: row.bookmark.url,
      title: row.bookmark.title,
      tag: row.bookmark.tag,
      saveForLater: row.bookmark.saveForLater,
      isImportant: row.bookmark.isImportant,
      isCompleted: row.bookmark.isCompleted,
      visibility: row.bookmark.visibility,
      folderId: row.bookmark.folderId,
      folderName: row.bookmark_folder.name,
      embeddingStatus: row.bookmark.embeddingStatus,
      createdAt: row.bookmark.createdAt,
    }),
  );
}

export async function createBookmarkForUser(userId: string, data: CreateBookmarkInput) {
  const normalizedContent = normalizeBookmarkContent(data.url);
  let url = normalizedContent.content;
  const note = data.note?.trim() || null;

  if (!url) {
    throw new Error("Bookmark content is required.");
  }

  const folder = await ensureFolderForUser(userId, data.folder ?? data.category);
  const userPreferences = await db
    .select({ utmEnabled: user.utmEnabled, utmSource: user.utmSource })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .then((rows) => rows[0]);
  if (normalizedContent.contentType === "link" && userPreferences?.utmEnabled) {
    try {
      const parsed = new URL(url);
      const utmSource = userPreferences.utmSource?.trim() || "usemark";
      parsed.searchParams.set("utm_source", utmSource);
      parsed.searchParams.set("utm_medium", "bookmark");
      parsed.searchParams.set("utm_campaign", "saved");
      url = parsed.toString();
    } catch {
      // Keep original URL when parsing fails.
    }
  }
  const bookmarkId = crypto.randomUUID();

  const record = {
    id: bookmarkId,
    userId,
    contentType: normalizedContent.contentType,
    url,
    title: normalizedContent.contentType === "text" ? url.slice(0, 80) : null,
    note,
    tag: getTagFromContent(url, normalizedContent.contentType),
    saveForLater: false,
    isImportant: false,
    isCompleted: false,
    visibility: "private",
    folderId: folder.id,
    embeddingStatus: "pending",
  } satisfies typeof bookmark.$inferInsert;

  try {
    await db.insert(bookmark).values(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("UNIQUE constraint failed") && !message.includes("constraint failed")) {
      throw error;
    }
    const existing = await db
      .select({ id: bookmark.id })
      .from(bookmark)
      .where(
        and(eq(bookmark.userId, userId), eq(bookmark.folderId, folder.id), eq(bookmark.url, url)),
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (existing?.id) {
      return { id: existing.id };
    }
    throw error;
  }

  return { id: bookmarkId };
}

function toSafeDate(value: Date | string | undefined) {
  if (!value) {
    return new Date();
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : new Date();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

async function listExistingSourceItemIdsForFolder(
  userId: string,
  folderId: string,
  sourceItemIds: string[],
) {
  const existing = new Set<string>();
  const uniqueIds = [...new Set(sourceItemIds.filter((id) => id.trim().length > 0))];
  for (let index = 0; index < uniqueIds.length; index += IMPORT_INSERT_CHUNK_SIZE) {
    const idChunk = uniqueIds.slice(index, index + IMPORT_INSERT_CHUNK_SIZE);
    if (idChunk.length === 0) {
      continue;
    }
    const rows = await db
      .select({ sourceItemId: bookmark.sourceItemId })
      .from(bookmark)
      .where(
        and(
          eq(bookmark.userId, userId),
          eq(bookmark.folderId, folderId),
          inArray(bookmark.sourceItemId, idChunk),
        ),
      );
    for (const row of rows) {
      if (row.sourceItemId) {
        existing.add(row.sourceItemId);
      }
    }
  }
  return existing;
}

export async function createBookmarksBatchForUser(
  userId: string,
  items: CreateBookmarksBatchInput[],
  options: { dedupeByUrlAndFolder?: boolean } = {},
) {
  const dedupeByUrlAndFolder = options.dedupeByUrlAndFolder ?? true;
  const folderCache = new Map<string, string>();
  const folderExistsCache = new Map<string, boolean>();
  const batchDeduplicationSet = new Set<string>();
  const prepared: Array<typeof bookmark.$inferInsert> = [];
  let skippedCount = 0;

  for (const item of items) {
    const normalizedContent = normalizeBookmarkContent(item.url ?? "");
    const url = normalizedContent.content.trim();
    if (!url) {
      skippedCount += 1;
      continue;
    }

    const folderName = item.folder ?? item.category ?? "default";
    const folderIdFromInput = item.folderId?.trim();
    const normalizedFolderName = normalizeFolderName(folderName);
    const cachedFolderId = folderCache.get(normalizedFolderName);
    const folderId =
      folderIdFromInput && folderIdFromInput.length > 0
        ? folderIdFromInput
        : (cachedFolderId ??
          (await ensureFolderForUser(userId, folderName).then((folder) => {
            folderCache.set(normalizedFolderName, folder.id);
            return folder.id;
          })));
    if (!folderId) {
      skippedCount += 1;
      continue;
    }
    if (folderIdFromInput && folderIdFromInput.length > 0) {
      const cachedExists = folderExistsCache.get(folderId);
      const folderExists =
        typeof cachedExists === "boolean"
          ? cachedExists
          : await db
              .select({ id: bookmarkFolder.id })
              .from(bookmarkFolder)
              .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, folderId)))
              .limit(1)
              .then((rows) => Boolean(rows[0]));
      folderExistsCache.set(folderId, folderExists);
      if (!folderExists) {
        skippedCount += 1;
        continue;
      }
    }

    const dedupeKey = `${folderId}::${url}`;
    if (batchDeduplicationSet.has(dedupeKey)) {
      skippedCount += 1;
      continue;
    }
    batchDeduplicationSet.add(dedupeKey);

    const contentType = item.contentType ?? normalizedContent.contentType;
    prepared.push({
      id: crypto.randomUUID(),
      userId,
      contentType,
      url,
      title: item.title?.trim() || (contentType === "text" ? url.slice(0, 80) : null),
      note: item.note?.trim() || null,
      tag: item.tag?.trim() || getTagFromContent(url, contentType),
      saveForLater: false,
      isImportant: false,
      isCompleted: false,
      visibility: "private",
      sourceItemId: item.sourceItemId ?? null,
      seenAt: item.seenAt ?? null,
      folderId,
      embeddingStatus: "pending",
      createdAt: toSafeDate(item.createdAt),
    });
  }

  if (prepared.length === 0) {
    return { createdIds: [] as string[], skippedCount, totalProcessed: items.length };
  }

  let toInsert = prepared;
  if (dedupeByUrlAndFolder) {
    const existingKeys = new Set<string>();
    const urlsByFolderId = new Map<string, string[]>();
    for (const row of prepared) {
      const urls = urlsByFolderId.get(row.folderId) ?? [];
      urls.push(row.url);
      urlsByFolderId.set(row.folderId, urls);
    }

    for (const [folderId, folderUrls] of urlsByFolderId) {
      const uniqueUrls = [...new Set(folderUrls)];
      for (let index = 0; index < uniqueUrls.length; index += IMPORT_INSERT_CHUNK_SIZE) {
        const urlChunk = uniqueUrls.slice(index, index + IMPORT_INSERT_CHUNK_SIZE);
        const existingRows = await db
          .select({ folderId: bookmark.folderId, url: bookmark.url })
          .from(bookmark)
          .where(
            and(
              eq(bookmark.userId, userId),
              eq(bookmark.folderId, folderId),
              inArray(bookmark.url, urlChunk),
            ),
          );
        for (const existingRow of existingRows) {
          existingKeys.add(`${existingRow.folderId}::${existingRow.url}`);
        }
      }
    }

    toInsert = prepared.filter((row) => !existingKeys.has(`${row.folderId}::${row.url}`));
    skippedCount += prepared.length - toInsert.length;
  }

  for (let index = 0; index < toInsert.length; index += IMPORT_INSERT_CHUNK_SIZE) {
    await db.insert(bookmark).values(toInsert.slice(index, index + IMPORT_INSERT_CHUNK_SIZE));
  }

  return {
    createdIds: toInsert.map((row) => row.id),
    skippedCount,
    totalProcessed: items.length,
  };
}

export async function bookmarkFolderExistsForUser(userId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    return false;
  }
  const existing = await db
    .select({ id: bookmarkFolder.id })
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)))
    .limit(1)
    .then((rows) => rows[0]);
  return Boolean(existing);
}

export async function deleteBookmarkForUser(userId: string, bookmarkId: string) {
  const normalizedBookmarkId = bookmarkId.trim();
  if (!normalizedBookmarkId) {
    throw new Error("Bookmark id is required.");
  }

  const existing = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return false;
  }

  await db
    .delete(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)));

  return true;
}

export async function deleteBookmarksForUser(userId: string, bookmarkIds: string[]) {
  const normalizedIds = [
    ...new Set(bookmarkIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  if (normalizedIds.length === 0) {
    return { deletedCount: 0 };
  }

  const existingRows = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.userId, userId), inArray(bookmark.id, normalizedIds)));
  const existingIds = existingRows.map((row) => row.id);
  if (existingIds.length === 0) {
    return { deletedCount: 0 };
  }

  await db
    .delete(bookmark)
    .where(and(eq(bookmark.userId, userId), inArray(bookmark.id, existingIds)));
  return { deletedCount: existingIds.length };
}

export async function renameBookmarkTitleForUser(
  userId: string,
  bookmarkId: string,
  title: string,
) {
  const normalizedBookmarkId = bookmarkId.trim();
  const normalizedTitle = title.trim();

  if (!normalizedBookmarkId) {
    throw new Error("Bookmark id is required.");
  }

  if (!normalizedTitle) {
    throw new Error("Title is required.");
  }

  const existing = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return false;
  }

  await db
    .update(bookmark)
    .set({ title: normalizedTitle })
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)));

  return true;
}

export async function updateBookmarkFlagsForUser(
  userId: string,
  bookmarkId: string,
  input: {
    saveForLater?: boolean;
    isImportant?: boolean;
    isCompleted?: boolean;
    visibility?: "private" | "public";
  },
) {
  const normalizedBookmarkId = bookmarkId.trim();
  if (!normalizedBookmarkId) {
    throw new Error("Bookmark id is required.");
  }

  const existing = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)))
    .limit(1)
    .then((rows) => rows[0]);
  if (!existing) {
    return false;
  }

  const changes: Partial<typeof bookmark.$inferInsert> = {};
  if (typeof input.saveForLater === "boolean") {
    changes.saveForLater = input.saveForLater;
  }
  if (typeof input.isImportant === "boolean") {
    changes.isImportant = input.isImportant;
  }
  if (typeof input.isCompleted === "boolean") {
    changes.isCompleted = input.isCompleted;
  }
  if (input.visibility === "private" || input.visibility === "public") {
    changes.visibility = input.visibility;
  }
  if (Object.keys(changes).length === 0) {
    return true;
  }

  await db
    .update(bookmark)
    .set(changes)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)));
  return true;
}

export async function refetchBookmarkMetadataForUser(userId: string, bookmarkId: string) {
  const normalizedBookmarkId = bookmarkId.trim();
  if (!normalizedBookmarkId) {
    throw new Error("Bookmark id is required.");
  }

  const existing = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, normalizedBookmarkId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return false;
  }

  await processBookmarkEmbedding(normalizedBookmarkId, { force: true, refreshTitle: true });
  return true;
}

export async function requestBookmarkEmbeddingForUser(
  userId: string,
  bookmarkId: string,
  options: { force?: boolean } = {},
) {
  const row = await db
    .select({
      id: bookmark.id,
      embeddingStatus: bookmark.embeddingStatus,
    })
    .from(bookmark)
    .where(and(eq(bookmark.id, bookmarkId), eq(bookmark.userId, userId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!row) {
    return null;
  }

  if (options.force || row.embeddingStatus !== "processing") {
    await db
      .update(bookmark)
      .set({
        embeddingStatus: "pending",
        embeddingError: null,
      })
      .where(eq(bookmark.id, bookmarkId));
  }

  return {
    id: bookmarkId,
    embeddingStatus: "pending" as const,
  };
}

export async function deleteBookmarkFolderForUser(userId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    throw new Error("Folder id is required.");
  }

  const existing = await db
    .select({ id: bookmarkFolder.id, name: bookmarkFolder.name })
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return "not-found";
  }

  if (existing.name === "default") {
    return "protected";
  }

  await db
    .delete(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)));

  return "deleted";
}

export async function pinBookmarkFolderForUser(userId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    throw new Error("Folder id is required.");
  }

  const existing = await db
    .select({ id: bookmarkFolder.id, isPinned: bookmarkFolder.isPinned })
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return false;
  }

  if (existing.isPinned) {
    return true;
  }

  await db.update(bookmarkFolder).set({ isPinned: false }).where(eq(bookmarkFolder.userId, userId));

  await db
    .update(bookmarkFolder)
    .set({ isPinned: true })
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)));

  return true;
}

export async function markBookmarkFolderSeenForUser(userId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    throw new Error("Folder id is required.");
  }

  await db
    .update(bookmark)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(bookmark.userId, userId),
        eq(bookmark.folderId, normalizedFolderId),
        isNotNull(bookmark.sourceItemId),
      ),
    );

  await db
    .update(bookmarkFolder)
    .set({ unseenCount: 0 })
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)));
}

export async function syncRssBookmarkFolder(
  folderId: string,
  options: { immediateInsertLimit?: number } = {},
) {
  const folder = await db
    .select()
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.id, folderId), eq(bookmarkFolder.sourceType, "rss")))
    .limit(1)
    .then((rows) => rows[0]);

  if (!folder?.externalResourceId || !folder.syncEnabled) {
    return {
      userId: folder?.userId ?? null,
      added: 0,
      bookmarkIds: [] as string[],
      deferredItems: [],
    };
  }

  const response = await fetch(getRssFetchUrl(folder.externalResourceId), {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "UseMarkBot/1.0 (+live folder sync)",
    },
  });

  if (!response.ok) {
    throw new Error("Could not fetch RSS feed.");
  }

  const xml = await response.text();
  const items = parseRssItems(xml, normalizeRssFetchLimit(folder.rssFetchLimit));
  const existingSourceItemIds = await listExistingSourceItemIdsForFolder(
    folder.userId,
    folder.id,
    items.map((item) => item.id),
  );
  const importCandidates: CreateBookmarksBatchInput[] = [];

  for (const item of items) {
    if (existingSourceItemIds.has(item.id)) {
      continue;
    }

    const normalized = normalizeBookmarkContent(item.url);
    if (normalized.contentType !== "link") {
      continue;
    }

    importCandidates.push({
      url: normalized.content,
      title: item.title,
      note: item.title,
      folderId: folder.id,
      folder: folder.name,
      contentType: "link",
      tag: getTagFromUrl(normalized.content),
      sourceItemId: item.id,
      seenAt: null,
      createdAt: item.publishedAt ?? new Date(),
    });
    existingSourceItemIds.add(item.id);
  }

  const immediateInsertLimit = Math.max(0, options.immediateInsertLimit ?? importCandidates.length);
  const immediateCandidates = importCandidates.slice(0, immediateInsertLimit);
  const deferredCandidates = importCandidates.slice(immediateInsertLimit);
  const immediateResult = await createBookmarksBatchForUser(folder.userId, immediateCandidates, {
    dedupeByUrlAndFolder: true,
  });

  const addedCount = immediateResult.createdIds.length;
  await db
    .update(bookmarkFolder)
    .set({
      lastSyncedAt: new Date(),
      unseenCount: folder.unseenCount + addedCount,
    })
    .where(eq(bookmarkFolder.id, folder.id));

  const keepRecentCount = normalizeRssKeepRecentCount(folder.rssKeepRecentCount);
  const orderedRssIds = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(
      and(
        eq(bookmark.userId, folder.userId),
        eq(bookmark.folderId, folder.id),
        isNotNull(bookmark.sourceItemId),
      ),
    )
    .orderBy(desc(bookmark.createdAt))
    .limit(keepRecentCount + RSS_INSERT_CHUNK_SIZE);
  const idsToDelete = orderedRssIds.slice(keepRecentCount).map((row) => row.id);
  if (idsToDelete.length > 0) {
    for (let index = 0; index < idsToDelete.length; index += RSS_INSERT_CHUNK_SIZE) {
      const deleteChunk = idsToDelete.slice(index, index + RSS_INSERT_CHUNK_SIZE);
      await db.delete(bookmark).where(inArray(bookmark.id, deleteChunk));
    }
  }

  return {
    userId: folder.userId,
    added: addedCount,
    bookmarkIds: immediateResult.createdIds,
    deferredItems: deferredCandidates,
  };
}

export async function listDueRssBookmarkFolderIds() {
  const now = Date.now();
  const rows = await db
    .select({
      id: bookmarkFolder.id,
      lastSyncedAt: bookmarkFolder.lastSyncedAt,
      syncIntervalMinutes: bookmarkFolder.syncIntervalMinutes,
    })
    .from(bookmarkFolder)
    .where(
      and(
        eq(bookmarkFolder.sourceType, "rss"),
        eq(bookmarkFolder.syncEnabled, true),
        or(isNull(bookmarkFolder.lastSyncedAt), lte(bookmarkFolder.lastSyncedAt, new Date(now))),
      ),
    );

  return rows
    .filter((row) => {
      if (!row.lastSyncedAt) {
        return true;
      }
      const intervalMs = normalizeRssSyncIntervalMinutes(row.syncIntervalMinutes) * 60_000;
      return row.lastSyncedAt.getTime() + intervalMs <= now;
    })
    .map((row) => row.id);
}

export async function processBookmarkEmbedding(
  bookmarkId: string,
  options: { force?: boolean; refreshTitle?: boolean } = {},
) {
  const row = await db
    .select()
    .from(bookmark)
    .innerJoin(bookmarkFolder, eq(bookmark.folderId, bookmarkFolder.id))
    .where(eq(bookmark.id, bookmarkId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!row) {
    return;
  }

  if (row.bookmark.embeddingStatus === "ready" && !options.force) {
    return;
  }

  await db
    .update(bookmark)
    .set({
      embeddingStatus: "processing",
      embeddingError: null,
    })
    .where(eq(bookmark.id, bookmarkId));

  try {
    const pageMetadata =
      row.bookmark.contentType === "link" ? await fetchBookmarkMetadata(row.bookmark.url) : null;
    const resolvedTitle =
      (options.refreshTitle ? pageMetadata?.title : (row.bookmark.title ?? pageMetadata?.title)) ??
      row.bookmark.title ??
      null;
    const baseEmbeddingText = toEmbeddingText({
      url: row.bookmark.url,
      contentType: row.bookmark.contentType,
      title: resolvedTitle,
      note: row.bookmark.note,
      folder: row.bookmark_folder.name,
      tag: row.bookmark.tag,
      createdAt: row.bookmark.createdAt,
    });
    const embeddingText = pageMetadata?.semanticText
      ? `${baseEmbeddingText}\npage_content: ${pageMetadata.semanticText}`
      : baseEmbeddingText;
    const embeddingVector = await embedText(embeddingText);

    await db
      .update(bookmark)
      .set({
        embedding: JSON.stringify(embeddingVector),
        embeddingModel: getEmbeddingModelName(),
        embeddingStatus: "ready",
        embeddingError: null,
        embeddedAt: new Date(),
        title: resolvedTitle,
      })
      .where(eq(bookmark.id, bookmarkId));
  } catch (error) {
    await db
      .update(bookmark)
      .set({
        embeddingStatus: "failed",
        embeddingError: error instanceof Error ? error.message : "Embedding failed",
      })
      .where(eq(bookmark.id, bookmarkId));
  }
}

export async function searchBookmarksForUser(userId: string, data: SearchBookmarkInput) {
  const query = data.query?.trim();
  if (!query) {
    return [] satisfies BookmarkRecord[];
  }
  const expandedQuery = expandQueryWithAliases(query);
  const effectiveQuery = expandedQuery.length > 0 ? expandedQuery : query;

  const dateFilter = parseRelativeDateRange(query);
  const whereClause = dateFilter
    ? and(
        eq(bookmark.userId, userId),
        gte(bookmark.createdAt, dateFilter.start),
        lte(bookmark.createdAt, dateFilter.end),
      )
    : eq(bookmark.userId, userId);

  const rows = await db
    .select()
    .from(bookmark)
    .innerJoin(bookmarkFolder, eq(bookmark.folderId, bookmarkFolder.id))
    .where(whereClause)
    .orderBy(desc(bookmark.createdAt));

  if (rows.length === 0) {
    return [] satisfies BookmarkRecord[];
  }

  const queryEmbedding = await embedText(effectiveQuery);
  const loweredQuery = effectiveQuery.toLowerCase();
  const queryTokens = tokenize(effectiveQuery);
  const queryTokenSet = new Set(queryTokens);

  const ranked = rows
    .map((row) => {
      let rowEmbedding: number[] = [];
      try {
        if (row.bookmark.embedding) {
          const parsed = JSON.parse(row.bookmark.embedding) as unknown;
          if (Array.isArray(parsed)) {
            rowEmbedding = parsed.filter((item): item is number => typeof item === "number");
          }
        }
      } catch {
        rowEmbedding = [];
      }

      const semanticScore =
        rowEmbedding.length > 0 ? cosineSimilarity(queryEmbedding, rowEmbedding) : 0;

      const searchableText = [
        row.bookmark.url,
        row.bookmark.title ?? "",
        row.bookmark.note ?? "",
        row.bookmark.tag,
        row.bookmark_folder.name,
        row.bookmark.contentType,
        row.bookmark.createdAt.toISOString(),
        row.bookmark.createdAt.toLocaleDateString("en", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      ]
        .join(" ")
        .toLowerCase();
      const rowHost = getUrlHost(row.bookmark.url);
      const rowTokens = tokenize(searchableText);
      const rowTokenSet = new Set(rowTokens);

      const exactPhraseBoost = searchableText.includes(loweredQuery) ? 0.2 : 0;
      const tokenOverlapCount = queryTokens.filter((token) => rowTokenSet.has(token)).length;
      const tokenOverlapRatio = queryTokens.length > 0 ? tokenOverlapCount / queryTokens.length : 0;
      const tokenOverlapBoost = tokenOverlapRatio * 0.35;

      const hostOrFolderMatchBoost = queryTokens.some(
        (token) =>
          rowHost.includes(token) ||
          row.bookmark.tag === token ||
          row.bookmark_folder.name === token,
      )
        ? 0.35
        : 0;

      const tagStartsWithQueryTokenBoost = queryTokens.some((token) =>
        row.bookmark.tag.startsWith(token),
      )
        ? 0.12
        : 0;

      const score =
        semanticScore * 0.65 +
        exactPhraseBoost +
        tokenOverlapBoost +
        hostOrFolderMatchBoost +
        tagStartsWithQueryTokenBoost;

      const hasAnyLexicalSignal =
        exactPhraseBoost > 0 ||
        tokenOverlapCount > 0 ||
        hostOrFolderMatchBoost > 0 ||
        tagStartsWithQueryTokenBoost > 0;

      // For short, intent-like queries ("google searches"), heavily favor lexical/domain matches.
      const adjustedScore = queryTokenSet.size <= 4 && hasAnyLexicalSignal ? score + 0.2 : score;
      return { row, score: adjustedScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((item, index, items) => {
      const topScore = items[0]?.score ?? 0;
      const normalizedMatchScore =
        topScore > 0 ? Math.round(Math.max(0, Math.min(1, item.score / topScore)) * 100) : 0;

      return toBookmarkRecord({
        id: item.row.bookmark.id,
        contentType: item.row.bookmark.contentType,
        url: item.row.bookmark.url,
        title: item.row.bookmark.title,
        tag: item.row.bookmark.tag,
        saveForLater: item.row.bookmark.saveForLater,
        isImportant: item.row.bookmark.isImportant,
        isCompleted: item.row.bookmark.isCompleted,
        visibility: item.row.bookmark.visibility,
        folderId: item.row.bookmark.folderId,
        folderName: item.row.bookmark_folder.name,
        embeddingStatus: item.row.bookmark.embeddingStatus,
        matchScore: normalizedMatchScore,
        createdAt: item.row.bookmark.createdAt,
      });
    });

  return ranked;
}

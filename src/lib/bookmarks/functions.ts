import { and, desc, eq, gte, lte, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookmark, bookmarkFolder } from "@/lib/db/schema";

import {
  cosineSimilarity,
  embedText,
  fetchPageSemanticText,
  getEmbeddingModelName,
  toEmbeddingText,
} from "./embeddings";

export type BookmarkContentType = "link" | "text";
export type BookmarkFolderSourceType = "local" | "rss" | "github" | "x" | "reddit";

export interface BookmarkRecord {
  id: string;
  contentType: BookmarkContentType;
  url: string;
  tag: string;
  folderId: string;
  folderName: string;
  embeddingStatus: string;
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
}

interface CreateBookmarkInput {
  url: string;
  note?: string;
  folder?: string;
  category?: string;
}

interface CreateBookmarkFolderInput {
  name: string;
  sourceType?: BookmarkFolderSourceType;
  syncEnabled?: boolean;
  externalAccountId?: string | null;
  externalResourceId?: string | null;
  visibility?: "private" | "public";
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

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
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
  const match = source.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1] ?? "") : "";
}

function getRssChannelName(xml: string) {
  const channelMatch = xml.match(/<channel\b[\s\S]*?<\/channel>/i);
  const channelXml = channelMatch?.[0] ?? xml;
  return readXmlTag(channelXml, "title");
}

export async function fetchRssChannelName(feedUrl: string) {
  const response = await fetch(feedUrl, {
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

function parseRssItems(xml: string) {
  const itemMatches = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)];

  return itemMatches
    .map((match): RssItem | null => {
      const itemXml = match[0];
      const title = readXmlTag(itemXml, "title") || "Untitled";
      const url = readXmlLink(itemXml);
      if (!url) {
        return null;
      }

      const guid = readXmlTag(itemXml, "guid") || readXmlTag(itemXml, "id") || url;
      const publishedValue = readXmlTag(itemXml, "pubDate") || readXmlTag(itemXml, "published") || readXmlTag(itemXml, "updated");
      const publishedAt = publishedValue ? new Date(publishedValue) : null;

      return {
        id: guid,
        title,
        url,
        publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null,
      };
    })
    .filter((item): item is RssItem => Boolean(item))
    .slice(0, 25);
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

function normalizeFolderSourceType(value: string | undefined): BookmarkFolderSourceType {
  if (value === "rss" || value === "github" || value === "x" || value === "reddit") {
    return value;
  }

  return "local";
}

function normalizeFolderVisibility(value: string | undefined) {
  return value === "public" ? "public" : "private";
}

const MONTH_INDEX_BY_NAME = new Map(
  [
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
  ] as const,
);

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
      sourceType === "local"
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
    id: crypto.randomUUID(),
    userId,
    name: normalizedName,
    sourceType,
    syncEnabled: input?.syncEnabled ?? sourceType !== "local",
    isPinned: false,
    visibility: normalizeFolderVisibility(input?.visibility),
    externalAccountId: input?.externalAccountId ?? null,
    externalResourceId: input?.externalResourceId?.trim() || null,
    unseenCount: 0,
    lastSyncedAt: null,
  } satisfies typeof bookmarkFolder.$inferInsert;

  await db.insert(bookmarkFolder).values(folder);
  return folder;
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
    })
    .from(bookmarkFolder)
    .where(eq(bookmarkFolder.userId, userId))
    .orderBy(desc(bookmarkFolder.isPinned), bookmarkFolder.name);

  return rows.map((row) => ({
    ...row,
    sourceType: normalizeFolderSourceType(row.sourceType),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  })) satisfies BookmarkFolderRecord[];
}

export async function createBookmarkFolderForUser(userId: string, input: CreateBookmarkFolderInput) {
  const folder = await ensureFolderForUser(
    userId,
    input.name || (input.sourceType === "rss" ? getFeedNameFromUrl(input.externalResourceId ?? "") : input.name),
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
  tag: string;
  folderId: string;
  folderName: string;
  embeddingStatus: string;
  createdAt: Date;
}): BookmarkRecord {
  return {
    id: row.id,
    contentType: row.contentType,
    url: row.url,
    tag: row.tag,
    folderId: row.folderId,
    folderName: row.folderName,
    embeddingStatus: row.embeddingStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBookmarksForUser(userId: string) {
  await ensureFolderForUser(userId, "default");

  const rows = await db
    .select()
    .from(bookmark)
    .innerJoin(bookmarkFolder, eq(bookmark.folderId, bookmarkFolder.id))
    .where(eq(bookmark.userId, userId))
    .orderBy(desc(bookmark.createdAt));

  return rows.map((row) =>
    toBookmarkRecord({
      id: row.bookmark.id,
      contentType: row.bookmark.contentType,
      url: row.bookmark.url,
      tag: row.bookmark.tag,
      folderId: row.bookmark.folderId,
      folderName: row.bookmark_folder.name,
      embeddingStatus: row.bookmark.embeddingStatus,
      createdAt: row.bookmark.createdAt,
    }),
  );
}

export async function createBookmarkForUser(userId: string, data: CreateBookmarkInput) {
  const normalizedContent = normalizeBookmarkContent(data.url);
  const url = normalizedContent.content;
  const note = data.note?.trim() || null;

  if (!url) {
    throw new Error("Bookmark content is required.");
  }

  const folder = await ensureFolderForUser(userId, data.folder ?? data.category);
  const bookmarkId = crypto.randomUUID();

  const record = {
    id: bookmarkId,
    userId,
    contentType: normalizedContent.contentType,
    url,
    note,
    tag: getTagFromContent(url, normalizedContent.contentType),
    folderId: folder.id,
    embeddingStatus: "pending",
  } satisfies typeof bookmark.$inferInsert;

  await db.insert(bookmark).values(record);

  return { id: bookmarkId };
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
    .select({ id: bookmarkFolder.id })
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return false;
  }

  await db
    .update(bookmarkFolder)
    .set({ isPinned: false })
    .where(eq(bookmarkFolder.userId, userId));

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
    .where(and(eq(bookmark.userId, userId), eq(bookmark.folderId, normalizedFolderId), isNotNull(bookmark.sourceItemId)));

  await db
    .update(bookmarkFolder)
    .set({ unseenCount: 0 })
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.id, normalizedFolderId)));
}

export async function syncRssBookmarkFolder(folderId: string) {
  const folder = await db
    .select()
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.id, folderId), eq(bookmarkFolder.sourceType, "rss")))
    .limit(1)
    .then((rows) => rows[0]);

  if (!folder?.externalResourceId || !folder.syncEnabled) {
    return { added: 0, bookmarkIds: [] };
  }

  const response = await fetch(folder.externalResourceId, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "UseMarkBot/1.0 (+live folder sync)",
    },
  });

  if (!response.ok) {
    throw new Error("Could not fetch RSS feed.");
  }

  const xml = await response.text();
  const items = parseRssItems(xml);
  let added = 0;
  const bookmarkIds: string[] = [];

  for (const item of items) {
    const normalized = normalizeBookmarkContent(item.url);
    if (normalized.contentType !== "link") {
      continue;
    }

    const existing = await db
      .select({ id: bookmark.id })
      .from(bookmark)
      .where(
        and(
          eq(bookmark.userId, folder.userId),
          eq(bookmark.folderId, folder.id),
          eq(bookmark.sourceItemId, item.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      continue;
    }

    const bookmarkId = crypto.randomUUID();

    await db.insert(bookmark).values({
      id: bookmarkId,
      userId: folder.userId,
      contentType: "link",
      url: normalized.content,
      note: item.title,
      tag: getTagFromUrl(normalized.content),
      sourceItemId: item.id,
      seenAt: null,
      folderId: folder.id,
      embeddingStatus: "pending",
      createdAt: item.publishedAt ?? new Date(),
    } satisfies typeof bookmark.$inferInsert);

    added += 1;
    bookmarkIds.push(bookmarkId);
  }

  await db
    .update(bookmarkFolder)
    .set({
      lastSyncedAt: new Date(),
      unseenCount: folder.unseenCount + added,
    })
    .where(eq(bookmarkFolder.id, folder.id));

  return { added, bookmarkIds };
}

export async function listDueRssBookmarkFolderIds() {
  const rows = await db
    .select({ id: bookmarkFolder.id })
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.sourceType, "rss"), eq(bookmarkFolder.syncEnabled, true)));

  return rows.map((row) => row.id);
}

export async function processBookmarkEmbedding(bookmarkId: string) {
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

  if (row.bookmark.embeddingStatus === "ready") {
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
    const pageText =
      row.bookmark.contentType === "link" ? await fetchPageSemanticText(row.bookmark.url) : "";
    const baseEmbeddingText = toEmbeddingText({
      url: row.bookmark.url,
      contentType: row.bookmark.contentType,
      note: row.bookmark.note,
      folder: row.bookmark_folder.name,
      tag: row.bookmark.tag,
      createdAt: row.bookmark.createdAt,
    });
    const embeddingText = pageText
      ? `${baseEmbeddingText}\npage_content: ${pageText}`
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

  const queryEmbedding = await embedText(query);
  const loweredQuery = query.toLowerCase();
  const queryTokens = tokenize(query);
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
    .map((item) =>
      toBookmarkRecord({
        id: item.row.bookmark.id,
        contentType: item.row.bookmark.contentType,
        url: item.row.bookmark.url,
        tag: item.row.bookmark.tag,
        folderId: item.row.bookmark.folderId,
        folderName: item.row.bookmark_folder.name,
        embeddingStatus: item.row.bookmark.embeddingStatus,
        createdAt: item.row.bookmark.createdAt,
      }),
    );

  return ranked;
}

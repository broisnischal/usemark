import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookmark, bookmarkFolder } from "@/lib/db/schema";

import {
  cosineSimilarity,
  embedText,
  fetchPageSemanticText,
  getEmbeddingModelName,
  toEmbeddingText,
} from "./embeddings";

export interface BookmarkRecord {
  id: string;
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
  sourceType: string;
  syncEnabled: boolean;
  externalAccountId: string | null;
  externalResourceId: string | null;
  lastSyncedAt: string | null;
}

interface CreateBookmarkInput {
  url: string;
  note?: string;
  folder?: string;
  category?: string;
}

interface SearchBookmarkInput {
  query: string;
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

function normalizeFolderName(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "default";
}

async function ensureFolderForUser(userId: string, folderName?: string) {
  const normalizedName = normalizeFolderName(folderName);

  const existing = await db
    .select()
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.name, normalizedName)))
    .limit(1)
    .then((rows) => rows[0]);

  if (existing) {
    return existing;
  }

  const folder = {
    id: crypto.randomUUID(),
    userId,
    name: normalizedName,
    sourceType: "local",
    syncEnabled: false,
    externalAccountId: null,
    externalResourceId: null,
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
      externalAccountId: bookmarkFolder.externalAccountId,
      externalResourceId: bookmarkFolder.externalResourceId,
      lastSyncedAt: bookmarkFolder.lastSyncedAt,
    })
    .from(bookmarkFolder)
    .where(eq(bookmarkFolder.userId, userId))
    .orderBy(bookmarkFolder.name);

  return rows.map((row) => ({
    ...row,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  })) satisfies BookmarkFolderRecord[];
}

export async function createBookmarkFolderForUser(userId: string, folderName: string) {
  const folder = await ensureFolderForUser(userId, folderName);
  return {
    id: folder.id,
    name: folder.name,
    sourceType: folder.sourceType,
    syncEnabled: folder.syncEnabled,
    externalAccountId: folder.externalAccountId,
    externalResourceId: folder.externalResourceId,
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
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }

  return null;
}

function toBookmarkRecord(row: {
  id: string;
  url: string;
  tag: string;
  folderId: string;
  folderName: string;
  embeddingStatus: string;
  createdAt: Date;
}): BookmarkRecord {
  return {
    id: row.id,
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
  const url = data.url?.trim();
  const note = data.note?.trim() || null;

  if (!url) {
    throw new Error("URL is required.");
  }

  const folder = await ensureFolderForUser(userId, data.folder ?? data.category);
  const bookmarkId = crypto.randomUUID();

  const record = {
    id: bookmarkId,
    userId,
    url,
    note,
    tag: getTagFromUrl(url),
    folderId: folder.id,
    embeddingStatus: "pending",
  } satisfies typeof bookmark.$inferInsert;

  await db.insert(bookmark).values(record);

  return { id: bookmarkId };
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
    const pageText = await fetchPageSemanticText(row.bookmark.url);
    const baseEmbeddingText = toEmbeddingText({
      url: row.bookmark.url,
      note: row.bookmark.note,
      folder: row.bookmark_folder.name,
      tag: row.bookmark.tag,
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

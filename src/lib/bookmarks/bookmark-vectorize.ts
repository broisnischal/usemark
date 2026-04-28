import "@tanstack/react-start/server-only";
import { env as workerEnv } from "cloudflare:workers";

/** Index: `wrangler vectorize create bookmark-semantic --dimensions=768 --metric=cosine` (@cf/baai/bge-base-en-v1.5). */

const MAX_VECTOR_SLOTS = 10;

/** Bookmark ids are globally unique; suffix distinguishes embedding chunks. */
function chunkVectorId(bookmarkId: string, chunkIndex: number) {
  return `${bookmarkId}:c${chunkIndex}`;
}

export function allChunkVectorIdsForBookmark(bookmarkId: string): string[] {
  return Array.from({ length: MAX_VECTOR_SLOTS }, (_, i) => chunkVectorId(bookmarkId, i));
}

export function getBookmarkVectorize() {
  return (workerEnv as { BOOKMARK_VECTORS?: VectorizeIndex }).BOOKMARK_VECTORS ?? null;
}

const VECTOR_DELETE_BATCH = 200;

export async function deleteBookmarkVectorsForUser(_userId: string, bookmarkIds: string[]) {
  const index = getBookmarkVectorize();
  if (!index || bookmarkIds.length === 0) {
    return;
  }
  const ids = bookmarkIds.flatMap((bid) => allChunkVectorIdsForBookmark(bid));
  try {
    for (let offset = 0; offset < ids.length; offset += VECTOR_DELETE_BATCH) {
      await index.deleteByIds(ids.slice(offset, offset + VECTOR_DELETE_BATCH));
    }
  } catch {
    // Index may be unavailable in some dev setups; DB remains source of truth.
  }
}

export async function upsertBookmarkEmbeddingChunks(input: {
  userId: string;
  bookmarkId: string;
  chunkTexts: string[];
  chunkVectors: number[][];
}): Promise<void> {
  const index = getBookmarkVectorize();
  if (!index) {
    return;
  }
  const { userId, bookmarkId, chunkTexts, chunkVectors } = input;
  if (chunkTexts.length !== chunkVectors.length || chunkTexts.length === 0) {
    return;
  }
  await index.deleteByIds(allChunkVectorIdsForBookmark(bookmarkId));

  const vectors: VectorizeVector[] = chunkTexts.map((_, i) => ({
    id: chunkVectorId(bookmarkId, i),
    namespace: userId,
    values: chunkVectors[i]!,
  }));

  try {
    await index.upsert(vectors);
  } catch {
    // Non-fatal: D1 still holds aggregate embedding for fallback search.
  }
}

/**
 * Returns max Vectorize similarity score per bookmark id for this user namespace.
 */
export async function queryBookmarkVectorScores(
  userId: string,
  queryVector: number[],
  topK: number,
): Promise<Map<string, number>> {
  const index = getBookmarkVectorize();
  if (!index) {
    return new Map();
  }
  const matches = await index.query(queryVector, {
    topK,
    namespace: userId,
  });
  const byBookmark = new Map<string, number>();
  for (const match of matches.matches) {
    const bookmarkId = match.id.replace(/:c\d+$/, "");
    if (!bookmarkId) {
      continue;
    }
    const prev = byBookmark.get(bookmarkId) ?? 0;
    if (match.score > prev) {
      byBookmark.set(bookmarkId, match.score);
    }
  }
  return byBookmark;
}

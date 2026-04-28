/** Chunk size tuned for ~512-token class embedding models (BGE base). */
const DEFAULT_MAX_CHARS = 1_900;
const DEFAULT_OVERLAP = 280;
const DEFAULT_MAX_CHUNKS = 10;

/**
 * Split long bookmark text into overlapping windows so each chunk fits the embedder
 * without silently truncating tail content.
 */
export function splitTextForEmbeddingChunks(
  text: string,
  options: { maxChars?: number; overlap?: number; maxChunks?: number } = {},
): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }
  const stride = Math.max(1, maxChars - overlap);
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length && chunks.length < maxChunks; start += stride) {
    chunks.push(normalized.slice(start, start + maxChars));
  }
  return chunks;
}

export function meanEmbeddingVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const dim = vectors[0]?.length ?? 0;
  if (dim === 0) {
    return [];
  }
  const acc = new Float64Array(dim);
  for (const vec of vectors) {
    if (vec.length !== dim) {
      continue;
    }
    for (let i = 0; i < dim; i += 1) {
      acc[i] += vec[i]!;
    }
  }
  const n = vectors.filter((v) => v.length === dim).length || 1;
  for (let i = 0; i < dim; i += 1) {
    acc[i] /= n;
  }
  return [...acc];
}

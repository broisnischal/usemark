import { env as workerEnv } from "cloudflare:workers";

const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

interface AiBinding {
  run: (model: string, input: unknown) => Promise<unknown>;
}

function getAiBinding() {
  return (workerEnv as { AI?: AiBinding }).AI;
}

export function getEmbeddingModelName() {
  return DEFAULT_EMBEDDING_MODEL;
}

export function toEmbeddingText(input: {
  contentType: string;
  url: string;
  title?: string | null;
  note?: string | null;
  folder: string;
  tag: string;
  createdAt: Date;
}) {
  const dateParts = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(input.createdAt);
  const month = dateParts.find((part) => part.type === "month")?.value ?? "";
  const weekday = dateParts.find((part) => part.type === "weekday")?.value ?? "";

  return [
    `type: ${input.contentType}`,
    input.title ? `title: ${input.title}` : "",
    `url: ${input.url}`,
    `tag: ${input.tag}`,
    `folder: ${input.folder}`,
    `saved_at: ${input.createdAt.toISOString()}`,
    month ? `saved_month: ${month}` : "",
    weekday ? `saved_weekday: ${weekday}` : "",
    input.note ? `note: ${input.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseEmbeddingVector(result: unknown): number[] {
  if (Array.isArray(result) && result.every((item) => typeof item === "number")) {
    return result;
  }

  if (result && typeof result === "object") {
    const objectResult = result as Record<string, unknown>;

    if (Array.isArray(objectResult.data) && objectResult.data.length > 0) {
      const firstItem = objectResult.data[0];
      if (Array.isArray(firstItem) && firstItem.every((item) => typeof item === "number")) {
        return firstItem;
      }
    }

    if (
      Array.isArray(objectResult.embedding) &&
      objectResult.embedding.every((item) => typeof item === "number")
    ) {
      return objectResult.embedding;
    }
  }

  throw new Error("Workers AI embedding response format is unsupported.");
}

export async function embedText(text: string) {
  const ai = getAiBinding();
  if (!ai) {
    throw new Error(
      'Missing Cloudflare AI binding. Add `ai: { binding: "AI" }` in wrangler config.',
    );
  }

  const result = await ai.run(DEFAULT_EMBEDDING_MODEL, {
    text: [text],
  });

  return parseEmbeddingVector(result);
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dotProduct += a[i]! * b[i]!;
    magnitudeA += a[i]! * a[i]!;
    magnitudeB += b[i]! * b[i]!;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

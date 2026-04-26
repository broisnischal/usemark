import "@tanstack/react-start/server-only";
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

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cleanTextFromHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
      .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
      .replaceAll(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replaceAll(/<\/(p|div|article|section|h1|h2|h3|li|br)>/gi, "\n")
      .replaceAll(/<[^>]+>/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim(),
  );
}

function matchGroup(source: string, expression: RegExp) {
  const result = source.match(expression);
  return result?.[1]?.trim() ?? "";
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

export async function fetchPageSemanticText(url: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "UseMarkBot/1.0 (+semantic bookmark indexer)",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();
    const htmlTitle = matchGroup(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescription = matchGroup(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    );
    const ogDescription = matchGroup(
      html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    );
    const articleBody = cleanTextFromHtml(
      matchGroup(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ||
        matchGroup(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
        matchGroup(html, /<body[^>]*>([\s\S]*?)<\/body>/i) ||
        html,
    );

    const excerpt = truncate(articleBody, 3500);
    const summary = [htmlTitle, metaDescription || ogDescription, excerpt]
      .filter(Boolean)
      .join("\n");
    return summary || null;
  } catch {
    return null;
  }
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

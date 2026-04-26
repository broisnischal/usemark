import "@tanstack/react-start/server-only";
import { env as workerEnv } from "cloudflare:workers";

import type { BookmarkRecord } from "./functions";
import { listBookmarksForUser, searchBookmarksForUser } from "./functions";

const DEFAULT_CHAT_MODEL: keyof AiModels = "@cf/meta/llama-3-8b-instruct";
const MAX_CONTEXT_ITEMS = 8;

interface AiBinding {
  run: (model: string, input: unknown) => Promise<unknown>;
}

function getAiBinding() {
  return (workerEnv as { AI?: AiBinding }).AI;
}

function toDateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function extractTextResponse(result: unknown): string | null {
  if (typeof result === "string") {
    return result;
  }

  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as Record<string, unknown>;

  if (typeof record.response === "string") {
    return record.response;
  }

  if (typeof record.output === "string") {
    return record.output;
  }

  if (record.result && typeof record.result === "object") {
    const nested = record.result as Record<string, unknown>;
    if (typeof nested.response === "string") {
      return nested.response;
    }
    if (typeof nested.output_text === "string") {
      return nested.output_text;
    }
  }

  return null;
}

function formatBookmarkContext(rows: BookmarkRecord[]) {
  return rows
    .map((row, index) => {
      return [
        `Source ${index + 1}`,
        `type: ${row.contentType}`,
        row.title ? `title: ${row.title}` : "",
        `${row.contentType === "link" ? "url" : "text"}: ${row.url}`,
        `tag: ${row.tag}`,
        `folder: ${row.folderName}`,
        `saved_at: ${toDateLabel(row.createdAt)}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

async function getContextRows(userId: string, question: string) {
  const semanticRows = await searchBookmarksForUser(userId, { query: question });
  if (semanticRows.length > 0) {
    return semanticRows.slice(0, MAX_CONTEXT_ITEMS);
  }

  const recentRows = await listBookmarksForUser(userId);
  return recentRows.slice(0, MAX_CONTEXT_ITEMS);
}

export interface BookmarkChatResponse {
  answer: string;
  sources: BookmarkRecord[];
  model: string;
}

export interface BookmarkChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(messages: BookmarkChatHistoryMessage[] | undefined) {
  if (!messages || messages.length === 0) {
    return [] as BookmarkChatHistoryMessage[];
  }

  return messages
    .filter((message) => {
      return (
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      );
    })
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 2000),
    }));
}

export async function askBookmarksForUser(
  userId: string,
  question: string,
  history?: BookmarkChatHistoryMessage[],
): Promise<BookmarkChatResponse> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    throw new Error("Question is required.");
  }

  const contextRows = await getContextRows(userId, normalizedQuestion);
  if (contextRows.length === 0) {
    return {
      answer: "I could not find any saved bookmarks yet. Save a few links first, then ask again.",
      sources: [],
      model: DEFAULT_CHAT_MODEL,
    };
  }

  const ai = getAiBinding();
  if (!ai) {
    throw new Error(
      'Missing Cloudflare AI binding. Add `ai: { binding: "AI" }` in wrangler config.',
    );
  }

  const systemPrompt = [
    "You are UseMark Assistant.",
    "Answer only using the bookmark context provided.",
    "If context is insufficient, clearly say you are not sure.",
    "Keep the answer concise and practical.",
    "End with a short 'Sources:' line listing matching source numbers (e.g. Sources: 1, 3).",
  ].join(" ");

  const userPrompt = [
    `Question: ${normalizedQuestion}`,
    "",
    "Bookmark context:",
    formatBookmarkContext(contextRows),
  ].join("\n");

  const chatHistory = sanitizeHistory(history);

  const result = await ai.run(DEFAULT_CHAT_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 700,
  });

  const answer = extractTextResponse(result) ?? "I could not generate an answer right now.";

  return {
    answer,
    sources: contextRows,
    model: DEFAULT_CHAT_MODEL,
  };
}

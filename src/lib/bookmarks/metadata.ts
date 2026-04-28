import "@tanstack/react-start/server-only";
import { load as loadHtml } from "cheerio";

export interface BookmarkMetadata {
  title: string | null;
  description: string | null;
  semanticText: string | null;
}

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_CONTENT_LENGTH_BYTES = 1_500_000;
const MAX_HTML_READ_BYTES = 1_500_000;
const MAX_BODY_TEXT_CHARS = 120_000;

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function collapseWhitespace(value: string) {
  return decodeHtmlEntities(value).replaceAll(/\s+/g, " ").trim();
}

function readMeta($: ReturnType<typeof loadHtml>, keys: string[]) {
  for (const key of keys) {
    const byName = collapseWhitespace($(`meta[name="${key}"]`).attr("content") ?? "");
    if (byName) {
      return byName;
    }
    const byProperty = collapseWhitespace($(`meta[property="${key}"]`).attr("content") ?? "");
    if (byProperty) {
      return byProperty;
    }
  }
  return "";
}

function readTextCandidates($: ReturnType<typeof loadHtml>, selectors: string[], limit: number) {
  const chunks: string[] = [];
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const value = collapseWhitespace($(element).text());
      if (!value) {
        return;
      }
      chunks.push(value);
    });
    if (chunks.length > 0) {
      break;
    }
  }
  return truncate(chunks.join("\n"), limit);
}

function readTaggedMainContent(
  $: ReturnType<typeof loadHtml>,
  selectors: string[],
  limits: Partial<Record<"h" | "p" | "li" | "blockquote" | "code", number>>,
) {
  const roots = selectors.join(", ");
  const sections: string[] = [];

  const collect = (label: string, selector: string, limit: number) => {
    const values: string[] = [];
    const seen = new Set<string>();
    $(roots)
      .find(selector)
      .each((_, element) => {
        if (values.length >= limit) {
          return false;
        }
        const text = collapseWhitespace($(element).text());
        if (!text || seen.has(text)) {
          return;
        }
        seen.add(text);
        values.push(text);
      });
    if (values.length > 0) {
      sections.push(`${label}:\n${values.map((value) => `- ${value}`).join("\n")}`);
    }
  };

  collect("headings", "h1, h2, h3, h4", limits.h ?? 50);
  collect("paragraphs", "p", limits.p ?? 400);
  collect("list_items", "li", limits.li ?? 300);
  collect("quotes", "blockquote", limits.blockquote ?? 80);
  collect("code_blocks", "pre, code", limits.code ?? 120);

  return sections.join("\n\n");
}

function toAbsoluteUrl(href: string, baseUrl: string) {
  const value = href.trim();
  if (!value) {
    return "";
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function readReferenceLinks($: ReturnType<typeof loadHtml>, sourceUrl: string, limit: number) {
  const scopedRoots = $("article, main, [role='main']");
  const roots = scopedRoots.length > 0 ? scopedRoots : $("body");
  const references: string[] = [];
  const seenUrls = new Set<string>();
  roots.find("a[href]").each((_, element) => {
    if (references.length >= limit) {
      return false;
    }
    const href = $(element).attr("href") ?? "";
    const absoluteUrl = toAbsoluteUrl(href, sourceUrl);
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      return;
    }
    const label = collapseWhitespace($(element).text());
    if (!label && absoluteUrl.startsWith(sourceUrl)) {
      return;
    }
    seenUrls.add(absoluteUrl);
    references.push(label ? `${label} -> ${absoluteUrl}` : absoluteUrl);
  });
  return references;
}

async function readTextWithByteLimit(response: Response, byteLimit: number) {
  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = result.value;
    totalLength += chunk.length;
    if (totalLength > byteLimit) {
      await reader.cancel("Response exceeded safe size limit.");
      return null;
    }
    chunks.push(chunk);
  }

  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(buffer);
}

function createMetadata(title: string | null, description: string | null, content?: string | null) {
  const normalizedTitle = title?.trim() || null;
  const normalizedDescription = description?.trim() || null;
  const normalizedContent = content?.trim() || null;
  const semanticText = normalizedContent
    ? normalizedContent
    : [normalizedTitle, normalizedDescription].filter(Boolean).join("\n");

  return {
    title: normalizedTitle,
    description: normalizedDescription,
    semanticText: semanticText || null,
  } satisfies BookmarkMetadata;
}

function isYoutubeUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

async function fetchYoutubeMetadata(url: string) {
  if (!isYoutubeUrl(url)) {
    return null;
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "UseMarkBot/1.0 (+bookmark metadata)",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      title?: unknown;
      author_name?: unknown;
    };
    const title = typeof payload.title === "string" ? decodeHtmlEntities(payload.title) : null;
    const authorName =
      typeof payload.author_name === "string" ? `YouTube channel: ${payload.author_name}` : null;

    return createMetadata(title, authorName);
  } catch {
    return null;
  }
}

async function fetchHtmlMetadata(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    signal: controller.signal,
    headers: {
      "User-Agent": "UseMarkBot/1.0 (+bookmark metadata)",
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

  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_CONTENT_LENGTH_BYTES) {
    return null;
  }

  const html = await readTextWithByteLimit(response, MAX_HTML_READ_BYTES);
  if (!html) {
    return null;
  }
  const $ = loadHtml(html);

  // Remove noisy nodes before extracting document text (nav/chrome, not article body).
  $(
    "script,style,noscript,svg,canvas,iframe,template,nav,footer,aside,header," +
      "[role=navigation],[role=banner],[role=complementary],[role=contentinfo]," +
      "[data-cookie],[class*=cookie],[id*=cookie],[class*=consent],[id*=consent]",
  ).remove();

  const title =
    readMeta($, ["og:title", "twitter:title"]) ||
    collapseWhitespace($("head > title").first().text());
  const description = readMeta($, ["description", "og:description", "twitter:description"]);
  const siteName = readMeta($, ["og:site_name"]);
  const author =
    readMeta($, ["author", "article:author", "og:article:author"]) ||
    collapseWhitespace($("meta[name='byline']").first().attr("content") ?? "");
  const keywords = readMeta($, ["keywords", "news_keywords"]);
  const publishedAt =
    readMeta($, [
      "article:published_time",
      "article:modified_time",
      "og:updated_time",
      "pubdate",
      "date",
    ]) || collapseWhitespace($("time[datetime]").first().attr("datetime") ?? "");
  const urlFromMeta = readMeta($, ["og:url", "twitter:url", "canonical"]);
  const canonical = collapseWhitespace($('link[rel="canonical"]').attr("href") ?? "");
  const headings = readTextCandidates(
    $,
    ["main h1, main h2, article h1, article h2", "h1, h2"],
    600,
  );
  const bodyText = readTextCandidates(
    $,
    [
      "article",
      "main",
      "[role='main']",
      "main p, article p, main li, article li, main pre, article pre",
      "body",
    ],
    MAX_BODY_TEXT_CHARS,
  );
  const taggedMainContent = readTaggedMainContent($, ["article", "main", "[role='main']", "body"], {
    h: 80,
    p: 500,
    li: 400,
    blockquote: 120,
    code: 160,
  });
  const references = readReferenceLinks($, url, 30);
  const extractedHost = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  const semanticText = [
    "page_document:",
    title ? `title: ${title}` : "",
    description ? `summary: ${description}` : "",
    siteName ? `site_name: ${siteName}` : "",
    author ? `author: ${author}` : "",
    publishedAt ? `published_at: ${publishedAt}` : "",
    keywords ? `keywords: ${keywords}` : "",
    extractedHost ? `host: ${extractedHost}` : "",
    canonical || urlFromMeta ? `canonical_url: ${canonical || urlFromMeta}` : "",
    headings ? `\nheadings:\n${headings}` : "",
    taggedMainContent ? `\nstructured_content:\n${taggedMainContent}` : "",
    bodyText ? `\nmain_content_plain:\n${bodyText}` : "",
    references.length > 0 ? `\nreferences:\n${references.map((ref) => `- ${ref}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return createMetadata(title, description || null, semanticText || null);
}

export async function fetchBookmarkMetadata(url: string) {
  const providerMetadata = await fetchYoutubeMetadata(url);
  if (providerMetadata?.title) {
    return providerMetadata;
  }

  return fetchHtmlMetadata(url);
}

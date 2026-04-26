import "@tanstack/react-start/server-only";

export interface BookmarkMetadata {
  title: string | null;
  description: string | null;
  semanticText: string | null;
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

function readMetaContent(html: string, attributeName: "name" | "property", attributeValue: string) {
  const escapedValue = attributeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagMatch = html.match(
    new RegExp(
      `<meta\\b(?=[^>]*\\b${attributeName}=["']${escapedValue}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`,
      "i",
    ),
  );
  return tagMatch?.[1]?.trim() ?? "";
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function createMetadata(title: string | null, description: string | null, content?: string | null) {
  const normalizedTitle = title?.trim() || null;
  const normalizedDescription = description?.trim() || null;
  const semanticText = [normalizedTitle, normalizedDescription, content]
    .filter(Boolean)
    .join("\n");

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
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const response = await fetch(url, {
    method: "GET",
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

  const html = await response.text();
  const htmlTitle = matchGroup(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitle = readMetaContent(html, "property", "og:title");
  const twitterTitle = readMetaContent(html, "name", "twitter:title");
  const metaDescription = readMetaContent(html, "name", "description");
  const ogDescription = readMetaContent(html, "property", "og:description");
  const twitterDescription = readMetaContent(html, "name", "twitter:description");
  const articleBody = cleanTextFromHtml(
    matchGroup(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ||
      matchGroup(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
      matchGroup(html, /<body[^>]*>([\s\S]*?)<\/body>/i) ||
      html,
  );

  return createMetadata(
    decodeHtmlEntities(ogTitle || twitterTitle || htmlTitle),
    decodeHtmlEntities(ogDescription || twitterDescription || metaDescription),
    truncate(articleBody, 3500),
  );
}

export async function fetchBookmarkMetadata(url: string) {
  const providerMetadata = await fetchYoutubeMetadata(url);
  if (providerMetadata?.title) {
    return providerMetadata;
  }

  return fetchHtmlMetadata(url);
}

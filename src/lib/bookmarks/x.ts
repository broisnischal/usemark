import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";

import { env } from "@/env/server";
import { db } from "@/lib/db";
import { bookmarkFolder, xConnection } from "@/lib/db/schema";

const X_AUTH_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_API_URL = "https://api.x.com/2";
const X_SCOPES = ["tweet.read", "users.read", "bookmark.read", "offline.access"] as const;

export interface XBookmarkRecord {
  id: string;
  url: string;
  title: string;
  authorName: string | null;
  username: string | null;
  createdAt: string | null;
  matchScore?: number;
}

export class XApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super("Could not fetch X bookmarks.");
    this.name = "XApiError";
    this.status = status;
    this.detail = detail;
  }
}

function getRedirectUri() {
  return new URL("/api/x/callback", env.VITE_BASE_URL).toString();
}

function base64UrlEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomString(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function encodeForm(data: Record<string, string>) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => params.set(key, value));
  return params;
}

function getTokenHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (env.X_CLIENT_SECRET) {
    const credentials = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
    headers.Authorization = `Basic ${credentials}`;
  }

  return headers;
}

export async function createXAuthorizationRequest() {
  if (!env.X_CLIENT_ID) {
    throw new Error("Missing X_CLIENT_ID.");
  }

  const state = randomString();
  const codeVerifier = randomString(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const url = new URL(X_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.X_CLIENT_ID);
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString(), state, codeVerifier };
}

async function exchangeCodeForToken(code: string, codeVerifier: string) {
  if (!env.X_CLIENT_ID) {
    throw new Error("Missing X_CLIENT_ID.");
  }

  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: getTokenHeaders(),
    body: encodeForm({
      code,
      grant_type: "authorization_code",
      client_id: env.X_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error("Could not exchange X authorization code.");
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

async function refreshXToken(refreshToken: string) {
  if (!env.X_CLIENT_ID) {
    throw new Error("Missing X_CLIENT_ID.");
  }

  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: getTokenHeaders(),
    body: encodeForm({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: env.X_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error("Could not refresh X access token.");
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

async function fetchXMe(accessToken: string) {
  const response = await fetch(`${X_API_URL}/users/me?user.fields=username,name`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Could not fetch X user.");
  }

  return (await response.json()) as {
    data: { id: string; username?: string; name?: string };
  };
}

export async function connectXAccountForUser(userId: string, code: string, codeVerifier: string) {
  const token = await exchangeCodeForToken(code, codeVerifier);
  const me = await fetchXMe(token.access_token);
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;

  const existing = await db
    .select({ id: xConnection.id })
    .from(xConnection)
    .where(eq(xConnection.userId, userId))
    .limit(1)
    .then((rows) => rows[0]);

  if (existing) {
    await db
      .update(xConnection)
      .set({
        xUserId: me.data.id,
        username: me.data.username ?? null,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        scope: token.scope ?? X_SCOPES.join(" "),
        accessTokenExpiresAt: expiresAt,
      })
      .where(eq(xConnection.id, existing.id));
  } else {
    await db.insert(xConnection).values({
      id: crypto.randomUUID(),
      userId,
      xUserId: me.data.id,
      username: me.data.username ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      scope: token.scope ?? X_SCOPES.join(" "),
      accessTokenExpiresAt: expiresAt,
    } satisfies typeof xConnection.$inferInsert);
  }

  const existingFolder = await db
    .select({ id: bookmarkFolder.id })
    .from(bookmarkFolder)
    .where(and(eq(bookmarkFolder.userId, userId), eq(bookmarkFolder.sourceType, "x")))
    .limit(1)
    .then((rows) => rows[0]);

  if (existingFolder) {
    await db
      .update(bookmarkFolder)
      .set({
        name: me.data.username ? `@${me.data.username}` : "x bookmarks",
        syncEnabled: true,
        externalAccountId: me.data.id,
        externalResourceId: "bookmarks",
      })
      .where(eq(bookmarkFolder.id, existingFolder.id));
  } else {
    await db.insert(bookmarkFolder).values({
      id: crypto.randomUUID(),
      userId,
      name: me.data.username ? `@${me.data.username}` : "x bookmarks",
      sourceType: "x",
      syncEnabled: true,
      externalAccountId: me.data.id,
      externalResourceId: "bookmarks",
    } satisfies typeof bookmarkFolder.$inferInsert);
  }
}

async function getActiveXConnection(userId: string) {
  const connection = await db
    .select()
    .from(xConnection)
    .where(eq(xConnection.userId, userId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!connection) {
    return null;
  }

  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? 0;
  if (connection.refreshToken && expiresAt > 0 && expiresAt < Date.now() + 60_000) {
    const token = await refreshXToken(connection.refreshToken);
    const nextExpiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : connection.accessTokenExpiresAt;

    await db
      .update(xConnection)
      .set({
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? connection.refreshToken,
        scope: token.scope ?? connection.scope,
        accessTokenExpiresAt: nextExpiresAt,
      })
      .where(and(eq(xConnection.userId, userId), eq(xConnection.id, connection.id)));

    return { ...connection, accessToken: token.access_token };
  }

  return connection;
}

export async function listXBookmarksForUser(userId: string) {
  const connection = await getActiveXConnection(userId);
  if (!connection) {
    return { connected: false, bookmarks: [] as XBookmarkRecord[] };
  }

  const url = new URL(`${X_API_URL}/users/${connection.xUserId}/bookmarks`);
  url.searchParams.set("max_results", "25");
  url.searchParams.set("tweet.fields", "created_at,author_id,entities");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new XApiError(response.status, detail.slice(0, 1200));
  }

  const payload = (await response.json()) as {
    data?: Array<{ id: string; text?: string; created_at?: string; author_id?: string }>;
    includes?: { users?: Array<{ id: string; name?: string; username?: string }> };
  };
  const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  const bookmarks = (payload.data ?? []).map((post) => {
    const author = post.author_id ? users.get(post.author_id) : undefined;
    const username = author?.username ?? null;
    return {
      id: post.id,
      url: username ? `https://x.com/${username}/status/${post.id}` : `https://x.com/i/status/${post.id}`,
      title: post.text?.replace(/\s+/g, " ").trim() || "X post",
      authorName: author?.name ?? null,
      username,
      createdAt: post.created_at ?? null,
    } satisfies XBookmarkRecord;
  });

  return { connected: true, bookmarks };
}

import "@tanstack/react-start/server-only";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { account, bookmarkFolder } from "@/lib/db/schema";

export type GitHubFolderResourceType = "all" | "issues" | "pulls" | "releases";

export interface GitHubItemRecord {
  id: string;
  url: string;
  title: string;
  type: GitHubFolderResourceType;
  state: string | null;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export class GitHubApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super("Could not fetch GitHub data.");
    this.name = "GitHubApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function normalizeGitHubResourceType(value: string | undefined): GitHubFolderResourceType {
  if (value === "issues" || value === "pulls" || value === "releases") {
    return value;
  }

  return "all";
}

export function normalizeGitHubRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "");
  const [owner, repo] = trimmed.split("/").filter(Boolean);

  if (!owner || !repo) {
    return null;
  }

  return `${owner}/${repo}`;
}

export function toGitHubExternalResourceId(repo: string, resourceType: GitHubFolderResourceType) {
  return `${repo}:${resourceType}`;
}

function parseGitHubExternalResourceId(value: string | null) {
  const [repo, resourceType] = value?.split(":") ?? [];
  const normalizedRepo = repo ? normalizeGitHubRepo(repo) : null;

  if (!normalizedRepo) {
    return null;
  }

  return {
    repo: normalizedRepo,
    resourceType: normalizeGitHubResourceType(resourceType),
  };
}

async function getGitHubAccessTokenForUser(userId: string) {
  const row = await db
    .select({ accessToken: account.accessToken, scope: account.scope })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
    .orderBy(desc(account.updatedAt))
    .limit(1)
    .then((rows) => rows[0]);

  return row ?? null;
}

function hasGitHubRepoScope(scope: string | null | undefined) {
  if (!scope) {
    return false;
  }
  const tokens = scope
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return tokens.some(
    (token) => token === "repo" || token === "public_repo" || token.startsWith("repo:"),
  );
}

async function fetchGitHub<TResponse>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "UseMarkBot/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GitHubApiError(response.status, detail.slice(0, 1200));
  }

  return (await response.json()) as TResponse;
}

type GitHubIssueApiRow = {
  id: number;
  html_url: string;
  title?: string | null;
  state?: string | null;
  user?: { login?: string | null } | null;
  pull_request?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

function mapIssueRowsToGitHubItems(rows: GitHubIssueApiRow[]): GitHubItemRecord[] {
  return rows.map((item) => ({
    id: String(item.id),
    url: item.html_url,
    title: item.title || "GitHub item",
    type: (item.pull_request ? "pulls" : "issues") as GitHubFolderResourceType,
    state: item.state ?? null,
    author: item.user?.login ?? null,
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
  }));
}

/**
 * List repo issues/PRs sorted by recent update. For "issues" or "pulls" only we use the Search API so
 * we are not limited to "the last 100 timeline entries" from /repos/.../issues (which mixes issues
 * and PRs — filtering that list often yields zero rows on busy repos even when many issues exist).
 */
async function listRepoIssuesOrPullsForResourceType(
  repo: string,
  resourceType: "all" | "issues" | "pulls",
  token: string,
): Promise<GitHubItemRecord[]> {
  if (resourceType === "issues" || resourceType === "pulls") {
    const typeQualifier = resourceType === "issues" ? "type:issue" : "type:pr";
    const q = `repo:${repo} ${typeQualifier}`;
    const params = new URLSearchParams({
      q,
      sort: "updated",
      order: "desc",
      per_page: "100",
    });
    const body = await fetchGitHub<{ items: GitHubIssueApiRow[] }>(
      `https://api.github.com/search/issues?${params.toString()}`,
      token,
    );
    return mapIssueRowsToGitHubItems(body.items ?? []);
  }

  const issues = await fetchGitHub<GitHubIssueApiRow[]>(
    `https://api.github.com/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100`,
    token,
  );

  return mapIssueRowsToGitHubItems(issues);
}

export async function listGitHubItemsForUser(userId: string, folderId: string) {
  const githubAccount = await getGitHubAccessTokenForUser(userId);
  const token = githubAccount?.accessToken ?? null;
  if (!token) {
    return { connected: false, items: [] as GitHubItemRecord[] };
  }

  const folder = await db
    .select({
      id: bookmarkFolder.id,
      externalResourceId: bookmarkFolder.externalResourceId,
    })
    .from(bookmarkFolder)
    .where(
      and(
        eq(bookmarkFolder.userId, userId),
        eq(bookmarkFolder.id, folderId),
        eq(bookmarkFolder.sourceType, "github"),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  const parsed = parseGitHubExternalResourceId(folder?.externalResourceId ?? null);
  if (!parsed) {
    return { connected: true, items: [] as GitHubItemRecord[] };
  }

  if (parsed.resourceType === "releases") {
    const releases = await fetchGitHub<
      Array<{
        id: number;
        html_url: string;
        name?: string | null;
        tag_name?: string | null;
        author?: { login?: string | null } | null;
        created_at?: string | null;
        published_at?: string | null;
      }>
    >(`https://api.github.com/repos/${parsed.repo}/releases?per_page=50`, token);

    return {
      connected: true,
      items: releases.map((release) => ({
        id: String(release.id),
        url: release.html_url,
        title: release.name || release.tag_name || "GitHub release",
        type: "releases",
        state: "published",
        author: release.author?.login ?? null,
        createdAt: release.published_at ?? release.created_at ?? null,
        updatedAt: release.published_at ?? release.created_at ?? null,
      })),
    };
  }

  const items = await listRepoIssuesOrPullsForResourceType(parsed.repo, parsed.resourceType, token);

  return { connected: true, items };
}

export async function listGitHubReposForUser(userId: string) {
  const githubAccount = await getGitHubAccessTokenForUser(userId);
  const token = githubAccount?.accessToken ?? null;
  if (!token) {
    return {
      connected: false,
      hasRepoScope: false,
      repos: [] as Array<{ id: number; fullName: string }>,
    };
  }

  const aggregated: Array<{
    id: number;
    full_name?: string | null;
    archived?: boolean;
    disabled?: boolean;
    updated_at?: string | null;
  }> = [];

  for (let page = 1; page <= 20; page += 1) {
    const pageRepos = await fetchGitHub<
      Array<{
        id: number;
        full_name?: string | null;
        archived?: boolean;
        disabled?: boolean;
        updated_at?: string | null;
      }>
    >(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`,
      token,
    );
    aggregated.push(...pageRepos);
    if (pageRepos.length < 100) {
      break;
    }
  }

  const seen = new Set<number>();
  const repos = aggregated.filter((repo) => {
    if (!repo.full_name || repo.archived || repo.disabled || seen.has(repo.id)) {
      return false;
    }
    seen.add(repo.id);
    return true;
  });

  return {
    connected: true,
    hasRepoScope: hasGitHubRepoScope(githubAccount?.scope),
    repos: repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name as string,
    })),
  };
}

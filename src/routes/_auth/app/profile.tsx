import {
  SiDevdotto,
  SiGithub,
  SiGoogle,
  SiMedium,
  SiReddit,
  SiX,
} from "@icons-pack/react-simple-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClipboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileUpIcon,
  Loader2Icon,
  MailIcon,
  RssIcon,
  ShieldIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { HoldToDelete } from "@/components/hold-to-delete";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";
import {
  isClipboardAutoPasteEnabled,
  setClipboardAutoPasteEnabled,
} from "@/lib/client-preferences";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/app/profile")({
  component: ProfilePage,
});

interface ProfileResponse {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
  };
  connections: {
    accounts: Array<{
      id: string;
      providerId: string;
      accountId: string;
      scope: string | null;
      createdAt: string;
    }>;
    x: Array<{
      id: string;
      username: string | null;
      createdAt: string;
    }>;
  };
  sharedFolders: Array<{
    id: string;
    name: string;
    sourceType: string;
    visibility: "private" | "public";
    syncEnabled: boolean;
  }>;
  publicBookmarks: Array<{
    id: string;
    title: string | null;
    url: string;
    tag: string;
    folderName: string;
    createdAt: string;
  }>;
  folderCount: number;
  availableProviders: {
    github: boolean;
    google: boolean;
    x: boolean;
    medium?: boolean;
    devto?: boolean;
  };
  preferences: {
    utmEnabled: boolean;
    utmSource: string;
  };
}

const profileQueryKey = ["profile"] as const;

function parseBrowserBookmarksHtml(fileContent: string) {
  if (typeof DOMParser === "undefined") {
    return [];
  }

  const parsed = new DOMParser().parseFromString(fileContent, "text/html");
  const anchors = Array.from(parsed.querySelectorAll("a"));
  const items = anchors
    .map((anchor) => {
      const url = anchor.getAttribute("href")?.trim() ?? "";
      if (!url) {
        return null;
      }
      const title = anchor.textContent?.trim() ?? "";
      return { url, title: title || null };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return items;
}

function detectBrowserFromBookmarksHtml(fileContent: string) {
  const content = fileContent.toLowerCase();
  if (content.includes("firefox")) {
    return "Firefox";
  }
  if (content.includes("brave")) {
    return "Brave";
  }
  if (content.includes("edg") || content.includes("edge")) {
    return "Edge";
  }
  if (content.includes("opera")) {
    return "Opera";
  }
  if (content.includes("chrome")) {
    return "Chrome";
  }
  if (content.includes("safari")) {
    return "Safari";
  }
  return "Browser";
}

async function readProfile() {
  const response = await fetch("/api/profile", { method: "GET" });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "Please sign in." : "Could not load profile.");
  }

  return (await response.json()) as ProfileResponse;
}

function providerLabel(providerId: string) {
  if (providerId === "github") {
    return "GitHub";
  }
  if (providerId === "google") {
    return "Google";
  }
  if (providerId === "credential") {
    return "Email password";
  }
  return providerId;
}

function ProviderIcon({ providerId }: { providerId: string }) {
  if (providerId === "github") {
    return <SiGithub className="size-5" />;
  }
  if (providerId === "google") {
    return <SiGoogle className="size-5" />;
  }
  return <ShieldIcon className="size-5 text-muted-foreground" />;
}

function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteConfirmation, setDeleteConfirmation] = React.useState("");
  const [showDeleteAccount, setShowDeleteAccount] = React.useState(false);
  const [utmDraft, setUtmDraft] = React.useState<{ enabled: boolean; source: string } | null>(null);
  const [clipboardAutoPasteEnabled, setClipboardAutoPasteEnabledState] = React.useState(false);
  const browserImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const profileQuery = useQuery({
    queryKey: profileQueryKey,
    queryFn: readProfile,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
  const profile = profileQuery.data;
  const providerIds = new Set(profile?.connections.accounts.map((item) => item.providerId) ?? []);
  const hasXConnection = Boolean(profile?.connections.x.length);

  React.useEffect(() => {
    setClipboardAutoPasteEnabledState(isClipboardAutoPasteEnabled());
  }, []);

  const connectGitHubMutation = useMutation({
    mutationFn: async () =>
      await authClient.linkSocial(
        {
          provider: "github",
          scopes: ["repo", "read:org", "user:email"],
          callbackURL: "/app/profile",
        },
        {
          onError: ({ error }) => {
            toast.error(error.message || "Could not connect GitHub.");
          },
        },
      ),
  });

  const connectGoogleMutation = useMutation({
    mutationFn: async () =>
      await authClient.linkSocial(
        {
          provider: "google",
          callbackURL: "/app/profile",
        },
        {
          onError: ({ error }) => {
            toast.error(error.message || "Could not connect Google.");
          },
        },
      ),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/profile", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(response.status === 401 ? "Please sign in." : "Could not delete account.");
      }
    },
    onSuccess: async () => {
      queryClient.clear();
      queryClient.setQueryData(authQueryOptions().queryKey, null);
      toast.success("Account deleted.");
      await router.invalidate();
      await router.navigate({ to: "/" });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not delete account.";
      toast.error(message);
    },
  });

  const saveUtmSettingsMutation = useMutation({
    mutationFn: async (payload: { utmEnabled: boolean; utmSource: string }) => {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update-utm-settings",
          utmEnabled: payload.utmEnabled,
          utmSource: payload.utmSource.trim() || "usemark",
        }),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401 ? "Please sign in." : "Could not save UTM settings.",
        );
      }
      return (await response.json()) as {
        success: true;
        preferences: { utmEnabled: boolean; utmSource: string };
      };
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(profileQueryKey, (current: ProfileResponse | undefined) =>
        current
          ? {
              ...current,
              preferences: result.preferences,
            }
          : current,
      );
      setUtmDraft(null);
      toast.success("UTM settings updated.");
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not save UTM settings.";
      toast.error(message);
    },
  });

  const exportBookmarksMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/bookmarks", { method: "GET" });
      if (!response.ok) {
        throw new Error(
          response.status === 401 ? "Please sign in." : "Could not export bookmarks.",
        );
      }
      return (await response.json()) as Array<{
        id: string;
        title: string | null;
        url: string;
        tag: string;
        folderName: string;
        contentType: "link" | "text";
        createdAt: string;
      }>;
    },
    onSuccess: (rows) => {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "bookmarks-export.json";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} bookmark${rows.length === 1 ? "" : "s"}.`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not export bookmarks.";
      toast.error(message);
    },
  });

  const importBrowserBookmarksMutation = useMutation({
    mutationFn: async (file: File) => {
      const raw = await file.text();
      const items = parseBrowserBookmarksHtml(raw);
      if (items.length === 0) {
        throw new Error("No bookmarks found in file.");
      }
      const browserName = detectBrowserFromBookmarksHtml(raw);
      const folderName = `${browserName} import ${new Date().toLocaleDateString()}`;

      const folderResponse = await fetch("/api/bookmark-folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: folderName,
          sourceType: "local",
          syncEnabled: false,
        }),
      });
      if (!folderResponse.ok) {
        throw new Error(
          folderResponse.status === 401 ? "Please sign in." : "Could not create import folder.",
        );
      }
      const createdFolder = (await folderResponse.json()) as { id: string; name: string };

      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dedupeByUrlAndFolder: false,
          items: items.map((item) => ({
            url: item.url,
            title: item.title,
            folder: createdFolder.name,
            folderId: createdFolder.id,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401 ? "Please sign in." : "Could not import bookmarks.",
        );
      }
      const importResult = (await response.json()) as {
        success: true;
        createdNow: number;
        queued: number;
        skipped: number;
      };
      return {
        ...importResult,
        folderName: createdFolder.name,
      };
    },
    onSuccess: async (result) => {
      const created = result.createdNow + result.queued;
      toast.success(`Import complete: ${created} added to ${result.folderName}.`);
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not import bookmarks.";
      toast.error(message);
    },
  });

  const onImportBrowserBookmarksFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    importBrowserBookmarksMutation.mutate(file);
  };

  if (profileQuery.isLoading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card/50 py-16 text-sm text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          Loading profile…
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Could not load profile.
          </CardContent>
        </Card>
      </main>
    );
  }

  const canDelete = deleteConfirmation.trim().toLowerCase() === profile.user.email.toLowerCase();
  const effectiveUtmEnabled = utmDraft?.enabled ?? profile.preferences.utmEnabled;
  const effectiveUtmSource = utmDraft?.source ?? (profile.preferences.utmSource || "usemark");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Profile</h1>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Account details, connected services, and how your marks appear publicly.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void profileQuery.refetch()}>
          {profileQuery.isFetching ? <Loader2Icon className="size-4 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/70 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-muted/30">
                  {profile.user.image ? (
                    <img
                      src={profile.user.image}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <UserIcon className="size-7 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold tracking-tight">
                    {profile.user.name}
                  </h2>
                  <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    <MailIcon className="size-4 shrink-0 opacity-80" />
                    <span className="truncate">{profile.user.email}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {profile.user.emailVerified ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2Icon className="size-3.5" />
                        Email verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                        <AlertCircleIcon className="size-3.5" />
                        Email not verified
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {profile.folderCount} folders
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <UsersIcon className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Shared folders</CardTitle>
              </div>
              <CardDescription>Collaboration and shared lists when available.</CardDescription>
            </CardHeader>
            <CardContent>
              {profile.sharedFolders.length ? (
                <ul className="grid gap-2">
                  {profile.sharedFolders.map((folder) => (
                    <li
                      key={folder.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{folder.name}</p>
                        <p className="text-xs text-muted-foreground">{folder.sourceType}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">Public</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  No shared folders yet. People and folder collaboration will appear here when
                  sharing ships.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Connections</CardTitle>
            </div>
            <CardDescription>
              OAuth accounts for sign-in and sync. Feeds for Medium and DEV use RSS live folders on
              Marks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Accounts
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {profile.connections.accounts.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background">
                        <ProviderIcon providerId={connection.providerId} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {providerLabel(connection.providerId)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {connection.accountId}
                        </p>
                      </div>
                    </div>
                    <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  </div>
                ))}
                {profile.connections.x.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background">
                        <SiX className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">X</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {connection.username ? `@${connection.username}` : "Connected"}
                        </p>
                      </div>
                    </div>
                    <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  </div>
                ))}
                {profile.availableProviders.github && !providerIds.has("github") ? (
                  <Button
                    variant="outline"
                    className="h-auto min-h-[3.25rem] justify-start gap-3 rounded-xl border-dashed py-3"
                    disabled={connectGitHubMutation.isPending}
                    onClick={() => connectGitHubMutation.mutate()}
                  >
                    {connectGitHubMutation.isPending ? (
                      <Loader2Icon className="size-5 animate-spin" />
                    ) : (
                      <SiGithub className="size-5" />
                    )}
                    <span className="text-sm font-medium">Connect GitHub</span>
                  </Button>
                ) : null}
                {profile.availableProviders.google && !providerIds.has("google") ? (
                  <Button
                    variant="outline"
                    className="h-auto min-h-[3.25rem] justify-start gap-3 rounded-xl border-dashed py-3"
                    disabled={connectGoogleMutation.isPending}
                    onClick={() => connectGoogleMutation.mutate()}
                  >
                    {connectGoogleMutation.isPending ? (
                      <Loader2Icon className="size-5 animate-spin" />
                    ) : (
                      <SiGoogle className="size-5" />
                    )}
                    <span className="text-sm font-medium">Connect Google</span>
                  </Button>
                ) : null}
                {profile.availableProviders.x && !hasXConnection ? (
                  <Button
                    variant="outline"
                    className="h-auto min-h-[3.25rem] justify-start gap-3 rounded-xl border-dashed py-3"
                    onClick={() => {
                      window.location.href = "/api/x/connect";
                    }}
                  >
                    <SiX className="size-5" />
                    <span className="text-sm font-medium">Connect X</span>
                  </Button>
                ) : null}
              </div>
            </div>

            <Separator />

            <div>
              <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Feeds & publishing
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(profile.availableProviders.medium ?? true) ? (
                  <div className="flex flex-col rounded-xl border border-border/70 bg-muted/10 p-4">
                    <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                      <SiMedium className="size-5" />
                    </span>
                    <p className="text-sm font-semibold">Medium</p>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                      Follow a Medium profile or publication by adding its RSS URL as a live folder
                      on Marks.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/app"
                        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                      >
                        Open Marks
                      </Link>
                      <a
                        href="https://help.medium.com/hc/en-us/articles/214874118-RSS-feeds"
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "inline-flex gap-1 no-underline",
                        )}
                      >
                        RSS help
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    </div>
                  </div>
                ) : null}
                {(profile.availableProviders.devto ?? true) ? (
                  <div className="flex flex-col rounded-xl border border-border/70 bg-muted/10 p-4">
                    <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                      <SiDevdotto className="size-5" />
                    </span>
                    <p className="text-sm font-semibold">DEV</p>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                      Use your{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        dev.to/feed/username
                      </code>{" "}
                      URL as an RSS live folder to sync posts.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/app"
                        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                      >
                        Open Marks
                      </Link>
                      <a
                        href="https://dev.to/settings/extensions#rss-import-tool"
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "inline-flex gap-1 no-underline",
                        )}
                      >
                        DEV feeds
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col rounded-xl border border-border/70 bg-muted/10 p-4">
                  <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                    <SiReddit className="size-5" />
                  </span>
                  <p className="text-sm font-semibold">Reddit</p>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    Open your Reddit feeds page and copy any feed URL to follow it as a live folder
                    on Marks.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to="/app"
                      className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                    >
                      Open Marks
                    </Link>
                    <a
                      href="https://www.reddit.com/prefs/feeds/"
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "inline-flex gap-1 no-underline",
                      )}
                    >
                      Reddit feeds
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  </div>
                </div>
                <div className="flex flex-col rounded-xl border border-border/70 bg-muted/10 p-4">
                  <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                    <RssIcon className="size-5 text-orange-600 dark:text-orange-400" />
                  </span>
                  <p className="text-sm font-semibold">RSS</p>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    Any site with a feed URL can become a live folder—newsletters, blogs, and more.
                  </p>
                  <Link
                    to="/app"
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "mt-3 w-fit",
                    )}
                  >
                    Add live folder
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UsersIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Public profile bookmarks</CardTitle>
            </div>
            <CardDescription>Links you marked as public from the marks list.</CardDescription>
          </CardHeader>
          <CardContent>
            {profile.publicBookmarks.length > 0 ? (
              <ul className="grid gap-2">
                {profile.publicBookmarks.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5 text-sm transition-colors hover:bg-muted/25"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title?.trim() || item.url}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.folderName} · {item.tag}
                        </p>
                      </div>
                      <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                No public bookmarks yet. Mark a bookmark as public from the marks list to show it
                here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <RssIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Bookmark UTM tracking</CardTitle>
            </div>
            <CardDescription>
              When enabled, new link bookmarks get UTM query parameters so you can attribute traffic
              in analytics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              htmlFor="utm-enabled-toggle"
              aria-labelledby="utm-enabled-title"
              className={cn(
                "flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors",
                effectiveUtmEnabled
                  ? "border-primary/35 bg-primary/5"
                  : "border-border/70 bg-muted/10 hover:bg-muted/20",
              )}
            >
              <Checkbox
                id="utm-enabled-toggle"
                className="mt-1"
                checked={effectiveUtmEnabled}
                onCheckedChange={(checked) =>
                  setUtmDraft((current) => ({
                    enabled: checked === true,
                    source: current?.source ?? effectiveUtmSource,
                  }))
                }
              />
              <span className="min-w-0">
                <span
                  id="utm-enabled-title"
                  className="block text-sm font-semibold text-foreground"
                >
                  Enable UTM on new links
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Applies to bookmarks you save as links from the marks page.
                </span>
              </span>
            </label>

            <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="utm-source">
                UTM source value
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Input
                  id="utm-source"
                  value={effectiveUtmSource}
                  onChange={(event) =>
                    setUtmDraft((current) => ({
                      enabled: current?.enabled ?? effectiveUtmEnabled,
                      source: event.target.value,
                    }))
                  }
                  placeholder="usemark"
                  className="h-10 max-w-md rounded-lg"
                />
                <Button
                  className="h-10 shrink-0 sm:w-28"
                  disabled={saveUtmSettingsMutation.isPending}
                  onClick={() =>
                    saveUtmSettingsMutation.mutate({
                      utmEnabled: effectiveUtmEnabled,
                      utmSource: effectiveUtmSource.trim() || "usemark",
                    })
                  }
                >
                  {saveUtmSettingsMutation.isPending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Example:{" "}
                <code className="rounded bg-background/80 px-1 font-mono">?utm_source=usemark</code>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Auto-paste link</CardTitle>
            </div>
            <CardDescription>
              Automatically paste a valid clipboard link into the Marks input.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="clipboard-auto-paste-toggle"
              className={cn(
                "flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors",
                clipboardAutoPasteEnabled
                  ? "border-primary/35 bg-primary/5"
                  : "border-border/70 bg-muted/10 hover:bg-muted/20",
              )}
            >
              <Checkbox
                id="clipboard-auto-paste-toggle"
                className="mt-1"
                checked={clipboardAutoPasteEnabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  setClipboardAutoPasteEnabled(enabled);
                  setClipboardAutoPasteEnabledState(enabled);
                  toast.success(enabled ? "Auto-paste link enabled." : "Auto-paste link disabled.");
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  Enable auto-paste link
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Runs when this tab is opened or focused, and only for valid URLs.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UploadIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Data</CardTitle>
            </div>
            <CardDescription>
              Export your saved bookmarks, or import browser bookmarks HTML into your default
              folder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2 rounded-xl transition-transform active:scale-[0.98]"
                disabled={exportBookmarksMutation.isPending}
                onClick={() => exportBookmarksMutation.mutate()}
              >
                {exportBookmarksMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <DownloadIcon className="size-4" />
                )}
                Export bookmarks
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2 rounded-xl transition-transform active:scale-[0.98]"
                disabled={importBrowserBookmarksMutation.isPending}
                onClick={() => browserImportInputRef.current?.click()}
              >
                {importBrowserBookmarksMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <FileUpIcon className="size-4" />
                )}
                Import browser bookmarks
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Use a bookmarks HTML file exported from Chrome/Firefox/Safari.
            </p>
            <input
              ref={browserImportInputRef}
              type="file"
              accept=".html,text/html"
              className="hidden"
              onChange={onImportBrowserBookmarksFile}
            />
          </CardContent>
        </Card>

        {!showDeleteAccount ? (
          <Card className="border-border/70 shadow-sm">
            <CardContent className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Need to remove your account and all data? This is permanent.
              </p>
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 sm:w-auto"
                onClick={() => setShowDeleteAccount(true)}
              >
                Delete my account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-destructive/40 shadow-md ring-1 ring-destructive/15">
            <CardHeader>
              <div className="flex items-start gap-3">
                <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div>
                  <CardTitle className="text-base text-destructive">Delete account</CardTitle>
                  <CardDescription className="mt-1 text-destructive/90">
                    Permanently deletes your profile, sessions, folders, bookmarks, embeddings, and
                    connections. This cannot be undone.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="delete-email"
                  >
                    Type your email to confirm
                  </label>
                  <Input
                    id="delete-email"
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    placeholder={profile.user.email}
                    autoComplete="off"
                    className="h-10"
                  />
                </div>
                <HoldToDelete
                  className="h-10"
                  disabled={!canDelete || deleteAccountMutation.isPending}
                  isPending={deleteAccountMutation.isPending}
                  onDelete={() => deleteAccountMutation.mutate()}
                >
                  Delete account
                </HoldToDelete>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit text-muted-foreground"
                onClick={() => {
                  setShowDeleteAccount(false);
                  setDeleteConfirmation("");
                }}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

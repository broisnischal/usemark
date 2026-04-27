import { SiGithub, SiGoogle, SiX } from "@icons-pack/react-simple-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  MailIcon,
  RssIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { HoldToDelete } from "@/components/hold-to-delete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";

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
  };
  preferences: {
    utmEnabled: boolean;
    utmSource: string;
  };
}

const profileQueryKey = ["profile"] as const;

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
    return <SiGithub className="size-4" />;
  }
  if (providerId === "google") {
    return <SiGoogle className="size-4" />;
  }
  return <ShieldIcon className="size-4" />;
}

function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteConfirmation, setDeleteConfirmation] = React.useState("");
  const [utmDraft, setUtmDraft] = React.useState<{ enabled: boolean; source: string } | null>(null);
  const profileQuery = useQuery({
    queryKey: profileQueryKey,
    queryFn: readProfile,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
  const profile = profileQuery.data;
  const providerIds = new Set(profile?.connections.accounts.map((item) => item.providerId) ?? []);
  const hasXConnection = Boolean(profile?.connections.x.length);

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

  if (profileQuery.isLoading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
          <Loader2Icon className="mr-2 size-4 animate-spin" />
          Loading profile
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          Could not load profile.
        </div>
      </main>
    );
  }

  const canDelete = deleteConfirmation.trim().toLowerCase() === profile.user.email.toLowerCase();
  const effectiveUtmEnabled = utmDraft?.enabled ?? profile.preferences.utmEnabled;
  const effectiveUtmSource = utmDraft?.source ?? (profile.preferences.utmSource || "usemark");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Account details, connected services, and sharing controls.
          </p>
        </div>
        <Button variant="outline" onClick={() => void profileQuery.refetch()}>
          {profileQuery.isFetching ? <Loader2Icon className="size-4 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-h-40 rounded-md border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
              {profile.user.image ? (
                <img
                  src={profile.user.image}
                  alt=""
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <UserIcon className="size-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">{profile.user.name}</h3>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <MailIcon className="size-3.5 shrink-0" />
                <span className="truncate">{profile.user.email}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex h-6 items-center gap-1 rounded-md border bg-background px-2 text-muted-foreground">
                  <CheckCircle2Icon className="size-3.5 text-emerald-600" />
                  {profile.user.emailVerified ? "Email verified" : "Email not verified"}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border bg-background px-2 text-muted-foreground">
                  {profile.folderCount} folders
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="min-h-40 rounded-md border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <UsersIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Shared Folders</h3>
          </div>
          {profile.sharedFolders.length ? (
            <div className="grid gap-2">
              {profile.sharedFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{folder.name}</p>
                    <p className="text-xs text-muted-foreground">{folder.sourceType}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">Public</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No shared folders yet. People and folder collaboration will appear here when sharing
              ships.
            </p>
          )}
        </section>
      </div>

      <section className="mt-4 rounded-md border bg-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <ShieldIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Connections</h3>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {profile.connections.accounts.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <ProviderIcon providerId={connection.providerId} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {providerLabel(connection.providerId)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{connection.accountId}</p>
                </div>
              </div>
              <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
            </div>
          ))}
          {profile.connections.x.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SiX className="size-4" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">X</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {connection.username ? `@${connection.username}` : "Connected"}
                  </p>
                </div>
              </div>
              <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
            </div>
          ))}
          {profile.availableProviders.github && !providerIds.has("github") ? (
            <Button
              variant="outline"
              className="justify-start"
              disabled={connectGitHubMutation.isPending}
              onClick={() => connectGitHubMutation.mutate()}
            >
              {connectGitHubMutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SiGithub className="size-4" />
              )}
              Connect GitHub
            </Button>
          ) : null}
          {profile.availableProviders.google && !providerIds.has("google") ? (
            <Button
              variant="outline"
              className="justify-start"
              disabled={connectGoogleMutation.isPending}
              onClick={() => connectGoogleMutation.mutate()}
            >
              {connectGoogleMutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SiGoogle className="size-4" />
              )}
              Connect Google
            </Button>
          ) : null}
          {profile.availableProviders.x && !hasXConnection ? (
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                window.location.href = "/api/x/connect";
              }}
            >
              <SiX className="size-4" />
              Connect X
            </Button>
          ) : null}
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
            <RssIcon className="size-4" />
            RSS folders connect per feed from the main app.
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-md border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <UsersIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Public profile bookmarks</h3>
        </div>
        {profile.publicBookmarks.length > 0 ? (
          <div className="grid gap-2">
            {profile.publicBookmarks.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title?.trim() || item.url}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.folderName} - {item.tag}
                  </p>
                </div>
                <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No public bookmarks yet. Mark a bookmark as public from the marks list to show it here.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-md border bg-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <RssIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Bookmark UTM tracking</h3>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Add UTM parameters automatically when saving new link bookmarks.
        </p>
        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border"
              checked={effectiveUtmEnabled}
              onChange={(event) =>
                setUtmDraft((current) => ({
                  enabled: event.target.checked,
                  source: current?.source ?? effectiveUtmSource,
                }))
              }
            />
            Enable UTM source
          </label>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="utm-source">
              UTM source value
            </label>
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
              className="h-9"
            />
          </div>
          <Button
            className="h-9"
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
            ) : null}
            Save
          </Button>
        </div>
      </section>

      <section className="mt-4 rounded-md border border-destructive/30 bg-card p-4">
        <div className="flex items-start gap-3">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-destructive">Delete Account</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This permanently deletes your profile, sessions, folders, bookmarks, embeddings, and
              connections.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={profile.user.email}
                aria-label="Type your email to confirm account deletion"
              />
              <HoldToDelete
                className="h-9"
                disabled={!canDelete || deleteAccountMutation.isPending}
                isPending={deleteAccountMutation.isPending}
                onDelete={() => deleteAccountMutation.mutate()}
              >
                Delete account
              </HoldToDelete>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

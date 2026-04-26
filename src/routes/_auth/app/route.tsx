import { useIsFetching, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import {
  BookmarkIcon,
  Loader2Icon,
  LogOutIcon,
  MoonIcon,
  Settings2Icon,
  SunIcon,
  UserIcon,
} from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";

export const Route = createFileRoute("/_auth/app")({
  component: AppLayout,
});

function AppLayout() {
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const isBusy = isFetching + isMutating > 0;

  const signOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onResponse: async () => {
          queryClient.setQueryData(authQueryOptions().queryKey, null);
          await router.invalidate();
        },
      },
    });
  };

  return (
    <div className="flex min-h-svh flex-col items-center bg-background">
      <div
        className="fixed top-0 right-0 left-0 z-50 h-0.5 overflow-hidden bg-transparent"
        aria-hidden={!isBusy}
      >
        <div
          className={`h-full bg-primary transition-[width,opacity] duration-300 ease-out ${
            isBusy ? "w-full opacity-100" : "w-0 opacity-0"
          }`}
        />
      </div>
      <header className="w-full border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/app"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-sm font-semibold shadow-sm"
            >
              U
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">UseMarks</h1>
              <p className="text-[11px] text-muted-foreground">
                {isBusy ? "Syncing changes" : "Ready"}
              </p>
            </div>
            {isBusy ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          <nav className="ml-auto hidden items-center gap-1 sm:flex">
            <Button render={<Link to="/app" />} variant="ghost" size="sm" nativeButton={false}>
              <BookmarkIcon />
              Marks
            </Button>
            <Button
              render={<Link to="/app/profile" />}
              variant="ghost"
              size="sm"
              nativeButton={false}
            >
              <UserIcon />
              Profile
            </Button>
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" />}>
              <Settings2Icon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link to="/app" />}>
                <BookmarkIcon />
                Marks
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/app/profile" />}>
                <UserIcon />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <SunIcon />
                Light theme
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <MoonIcon />
                Dark theme
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="w-full max-w-6xl">
        <Outlet />
      </div>
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BookmarkIcon,
  BugIcon,
  CircleHelpIcon,
  FileTextIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RssIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";

export const Route = createFileRoute("/_auth/app")({
  component: AppLayout,
});

function AppLayout() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const marksNavActive = pathname === "/app" || pathname === "/app/";
  const feedsNavActive = pathname.startsWith("/app/feeds");

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

  const reportBug = () => {
    window.open(
      "https://github.com/broisnischal/usemark/issues/new?template=bug_report.yml",
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="w-full border-b border-border/80 bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4 sm:gap-8 sm:px-6">
          <Link
            to="/app"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-sm font-semibold shadow-sm shadow-foreground/5 transition-colors hover:bg-muted/60"
            aria-label="UseMarks home"
          >
            U
          </Link>

          <nav
            className="flex flex-1 items-center justify-center gap-1 sm:justify-start sm:pl-2"
            aria-label="App"
          >
            <Link
              to="/app"
              className={
                marksNavActive
                  ? "inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground"
                  : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              }
            >
              <BookmarkIcon className="size-3.5" />
              Marks
            </Link>
            <Link
              to="/app/feeds"
              className={
                feedsNavActive
                  ? "inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground"
                  : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              }
            >
              <RssIcon className="size-3.5" />
              Feeds
            </Link>
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="size-9 rounded-full border-border/70 bg-muted/25 shadow-sm hover:bg-muted/50"
                />
              }
            >
              <Settings2Icon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link to="/app/profile" />}>
                  <Settings2Icon />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link to="/app/help" />}>
                <CircleHelpIcon />
                Help & Support
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/app/terms" />}>
                <FileTextIcon />
                Terms & Conditions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={reportBug}>
                <BugIcon />
                Report bug
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <PaletteIcon />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent side="left" align="start" className="min-w-44">
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) => setTheme(value as "dark" | "light" | "system")}
                  >
                    <DropdownMenuRadioItem value="light">
                      <SunIcon />
                      Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <MoonIcon />
                      Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <MonitorIcon />
                      System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="w-full flex-1">
        <Outlet />
      </div>

      <footer className="mt-auto w-full border-t border-border/80 bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-5 text-sm sm:justify-between sm:px-6">
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-muted-foreground">
            <Link to="/app/help" className="transition-colors hover:text-foreground">
              Help
            </Link>
            <Link to="/app/learn" className="transition-colors hover:text-foreground">
              Learn
            </Link>
            <Link to="/app/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </nav>
          <p className="text-center text-xs text-muted-foreground sm:text-left">UseMarks</p>
        </div>
      </footer>
    </div>
  );
}

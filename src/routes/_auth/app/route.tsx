import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import {
  BookmarkIcon,
  BugIcon,
  CircleHelpIcon,
  FileTextIcon,
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

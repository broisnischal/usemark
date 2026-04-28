import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  FolderKanbanIcon,
  KeyboardIcon,
  LockIcon,
  NewspaperIcon,
  RssIcon,
  SearchIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "UseMark — Calm bookmarking",
      },
      {
        name: "description",
        content:
          "Save links, follow popular RSS feeds, search instantly, and keep everything organized in one calm place.",
      },
    ],
  }),
  component: HomePage,
});

const features = [
  {
    icon: SparklesIcon,
    title: "Auto metadata",
    description: "Paste a link and get title, description, and favicon automatically.",
  },
  {
    icon: FolderKanbanIcon,
    title: "Collections",
    description: "Use folders that stay easy to scan even as your library grows.",
  },
  {
    icon: SearchIcon,
    title: "Instant search",
    description: "Find by title, URL, host, or category in a few keystrokes.",
  },
  {
    icon: KeyboardIcon,
    title: "Keyboard-first",
    description: "Shortcuts for adding, searching, navigating, and focusing quickly.",
  },
  {
    icon: NewspaperIcon,
    title: "Feeds directory",
    description: "Browse popular feeds by category and follow each as a live folder.",
  },
  {
    icon: RssIcon,
    title: "Starter feed included",
    description: "New accounts start with Hacker News front page ready to go.",
  },
  {
    icon: UploadIcon,
    title: "Submit to Hacker News",
    description: "From any non-HN link, submit directly from the bookmark menu.",
  },
  {
    icon: LockIcon,
    title: "Private by default",
    description: "Your saved links are yours. No ads, no social noise.",
  },
] as const;

function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
          >
            UseMark
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to="/terms" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Terms
            </Link>
            <Link to="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Sign in
            </Link>
            <Link to="/signup" className={buttonVariants({ variant: "default", size: "sm" })}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="relative border-b border-border/40 px-4 pt-16 pb-18 sm:px-6 sm:pt-20 sm:pb-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,color-mix(in_oklab,var(--foreground)_6%,transparent),transparent)]"
          />
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <p className="frappe-chip mb-6 text-[0.6875rem] font-medium tracking-widest text-muted-foreground uppercase">
              Bookmarking
            </p>
            <h1 className="text-4xl font-semibold tracking-tighter text-balance text-foreground sm:text-5xl md:text-6xl md:leading-[1.05]">
              Save links. Follow feeds. Find things fast.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              UseMark keeps bookmarking simple: clean folders, fast search, live RSS feeds, and a UI
              that stays out of your way.
            </p>
            <div
              className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground"
              aria-label="Open the command palette with Command K or Control K"
            >
              <span>Open the palette</span>
              <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-foreground">
                <kbd className="rounded-md border border-border bg-muted/80 px-1.5 py-0.5 shadow-sm">
                  ⌘K
                </kbd>
                <span className="text-muted-foreground/50">/</span>
                <kbd className="rounded-md border border-border bg-muted/80 px-1.5 py-0.5 shadow-sm">
                  Ctrl K
                </kbd>
              </span>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link to="/signup" className={buttonVariants({ variant: "default", size: "lg" })}>
                Get started
              </Link>
              <Link to="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
                I have an account
              </Link>
            </div>
            <div className="mt-7 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>Starter feed included</span>
              <span aria-hidden>•</span>
              <span>Keyboard-first</span>
              <span aria-hidden>•</span>
              <span>Private by default</span>
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6 sm:py-16">
          <div className="mx-auto w-full max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Everything in one quiet workflow
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Add a link, follow a feed, open your folder, keep moving.
              </p>
            </div>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <li
                  key={title}
                  className="group rounded-xl border border-border/70 bg-card/30 p-4 transition-colors hover:bg-card/70"
                >
                  <div className="flex size-8 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-foreground transition-colors group-hover:bg-muted">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold tracking-tight text-foreground">
                    {title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-border/60 bg-muted/15 px-4 py-12 sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card/50 p-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                Start with your first folder today
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Open the app, paste a URL, and follow a feed in under a minute.
              </p>
            </div>
            <Link
              to="/app"
              className={cn(buttonVariants({ variant: "default", size: "lg" }), "gap-2")}
            >
              Open UseMark
              <ArrowUpRightIcon className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 bg-muted/10 px-4 py-8 sm:px-6">
        <div className="mx-auto grid w-full max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-sm font-medium tracking-tight text-foreground">UseMark</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              © {new Date().getFullYear()} UseMark. Calm bookmarking for daily use.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-start lg:justify-center">
            <Link to="/terms" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Terms & Conditions
            </Link>
            <Link to="/signup" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Create account
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-start lg:justify-end">
            <Link to="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Sign in
            </Link>
            <Link to="/signup" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Get started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

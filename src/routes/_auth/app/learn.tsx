import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, SearchIcon } from "lucide-react";

export const Route = createFileRoute("/_auth/app/learn")({
  component: LearnPage,
});

const SEARCH_EXAMPLES = [
  "host:reddit.com",
  "site:github.com",
  "domain:example.com",
  "path:/r/reactjs",
  "folder:default",
  "tag:reddit",
  "type:link",
  "type:text",
  "subreddit:reactjs",
  "sub:reactjs",
  "r:reactjs",
];

function LearnPage() {
  const navigate = useNavigate();

  const useExample = (example: string) => {
    void navigate({
      to: "/app",
      search: example.trim() ? { q: example.trim() } : {},
    });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Learn Advanced Search</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use filter operators to find bookmarks by host, path, folder, tag, type, and subreddit.
        </p>
      </div>

      <section className="rounded-xl border bg-card/80 p-4 shadow-sm shadow-foreground/5">
        <div className="mb-3 flex items-center gap-2">
          <BookOpenIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Filter Operators</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SEARCH_EXAMPLES.map((example) => (
            <button
              type="button"
              key={example}
              className="group inline-flex items-center justify-between gap-2 rounded-lg border bg-background/80 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              onClick={() => useExample(example)}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <code className="truncate text-xs">{example}</code>
              </span>
              <span className="inline-flex h-6 items-center rounded-md border bg-background px-2 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                Use
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-xl border bg-card/80 p-4 shadow-sm shadow-foreground/5">
        <h3 className="text-sm font-semibold">Tips</h3>
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
          <li>
            Combine filters: <code>host:reddit.com tag:react</code>
          </li>
          <li>
            Add free text with filters: <code>host:github.com tanstack router</code>
          </li>
          <li>
            For path filters, values starting with <code>/</code> or <code>?</code> match from the
            start.
          </li>
        </ul>
      </section>
    </main>
  );
}

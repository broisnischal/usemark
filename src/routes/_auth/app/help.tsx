import { createFileRoute } from "@tanstack/react-router";
import { BugIcon, ExternalLinkIcon, LifeBuoyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

const GITHUB_ISSUES_URL = "https://github.com/broisnischal/usemark/issues";
const GITHUB_NEW_BUG_URL =
  "https://github.com/broisnischal/usemark/issues/new?template=bug_report.yml";

export const Route = createFileRoute("/_auth/app/help")({
  component: HelpSupportPage,
});

function HelpSupportPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Help & Support</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Find help resources and track/report issues directly in GitHub.
        </p>
      </div>

      <section className="rounded-md border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <LifeBuoyIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Issue tracking</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          We track bugs and feature requests in GitHub Issues. You can browse existing reports or
          open a new one.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(GITHUB_ISSUES_URL, "_blank", "noopener,noreferrer")}
          >
            <ExternalLinkIcon />
            View issues
          </Button>
          <Button onClick={() => window.open(GITHUB_NEW_BUG_URL, "_blank", "noopener,noreferrer")}>
            <BugIcon />
            Report bug
          </Button>
        </div>
      </section>
    </main>
  );
}

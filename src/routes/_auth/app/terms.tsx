import { createFileRoute } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";

export const Route = createFileRoute("/_auth/app/terms")({
  component: TermsConditionsPage,
});

function TermsConditionsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Terms & Conditions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Basic usage terms for UseMark. Replace this with your final legal copy before production.
        </p>
      </div>

      <section className="rounded-md border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Summary</h3>
        </div>
        <ul className="grid gap-2 text-sm text-muted-foreground">
          <li>Use this app responsibly and comply with third-party platform policies.</li>
          <li>You are responsible for content and links saved in your account.</li>
          <li>Do not misuse integrations (GitHub, X, RSS) or attempt unauthorized access.</li>
          <li>Service features may change as the app evolves.</li>
        </ul>
      </section>
    </main>
  );
}

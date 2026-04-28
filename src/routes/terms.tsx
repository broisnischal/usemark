import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, FileTextIcon, ShieldCheckIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "UseMark — Terms & Conditions" },
      {
        name: "description",
        content:
          "Terms and conditions for UseMark covering account usage, acceptable conduct, intellectual property, and service limits.",
      },
    ],
  }),
  component: TermsPage,
});

const sections = [
  {
    title: "1. Acceptance of Terms",
    content:
      "By creating an account or using UseMark, you agree to these terms and all applicable laws. If you do not agree, do not use the service.",
  },
  {
    title: "2. Accounts and Access",
    content:
      "You are responsible for maintaining the security of your account credentials and for all activity under your account.",
  },
  {
    title: "3. Acceptable Use",
    content:
      "You agree not to use UseMark for unlawful content, abuse third-party integrations, attempt unauthorized access, or interfere with service stability.",
  },
  {
    title: "4. User Content",
    content:
      "You retain ownership of links, notes, and metadata you save. You grant UseMark permission to process this data only to provide and improve product features.",
  },
  {
    title: "5. Third-Party Services",
    content:
      "Some functionality relies on external services (such as RSS sources, GitHub, or other providers). Availability and behavior of those services are outside UseMark's control.",
  },
  {
    title: "6. Service Availability",
    content:
      "UseMark is provided on an as-is basis. Features may change, be suspended, or be removed as the product evolves.",
  },
  {
    title: "7. Limitation of Liability",
    content:
      "To the fullest extent permitted by law, UseMark is not liable for indirect, incidental, or consequential damages resulting from service use or interruption.",
  },
  {
    title: "8. Termination",
    content:
      "You may stop using the service at any time. We reserve the right to restrict or terminate access when terms are violated.",
  },
  {
    title: "9. Updates to Terms",
    content:
      "We may update these terms to reflect legal or product changes. Continued use after updates means you accept the revised terms.",
  },
] as const;

function TermsPage() {
  return (
    <main className="min-h-svh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
            <ArrowLeftIcon className="size-4" />
            Back to home
          </Link>
          <span className="text-xs text-muted-foreground">Last updated: April 2026</span>
        </div>

        <section className="rounded-2xl border border-border/70 bg-card/40 p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Terms & Conditions
            </h1>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            These terms govern your use of UseMark and related features. This page provides a
            plain-language framework for product usage and responsibilities.
          </p>
        </section>

        <section className="mt-6 grid gap-3">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-xl border border-border/60 bg-card/20 p-5"
            >
              <div className="mb-2 flex items-center gap-2">
                <FileTextIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold tracking-tight sm:text-base">
                  {section.title}
                </h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{section.content}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

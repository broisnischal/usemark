"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/components/theme-provider";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-center"
      offset={16}
      visibleToasts={3}
      gap={8}
      expand={false}
      richColors
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />,
        info: <InfoIcon className="size-4 text-sky-600 dark:text-sky-400" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />,
        error: <OctagonXIcon className="size-4 text-rose-600 dark:text-rose-400" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        duration: 2600,
        classNames: {
          toast:
            "cn-toast min-h-[44px] w-full max-w-[min(92vw,360px)] rounded-xl border border-border/80 bg-popover/95 px-3 py-2 text-popover-foreground shadow-xl shadow-black/10 ring-1 ring-black/5 backdrop-blur-xl transition-all duration-150 ease-out dark:border-border/70 dark:bg-popover/92 dark:shadow-black/40 dark:ring-white/10",
          title: "text-sm font-medium leading-5 tracking-tight",
          description: "mt-0.5 text-xs leading-4 text-muted-foreground",
          icon: "mr-2 shrink-0 rounded-md bg-muted/70 p-1",
          actionButton:
            "h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85",
          cancelButton:
            "h-7 rounded-md bg-muted px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
          closeButton:
            "h-5 w-5 rounded-md border border-border/60 bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

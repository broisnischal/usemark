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
import { cn } from "@/lib/utils";

const defaultToastClassNames: NonNullable<ToasterProps["toastOptions"]>["classNames"] = {
  toast: cn(
    "sonner-app-toast flex min-h-12 w-full max-w-[min(92vw,22rem)] items-center gap-3.5 rounded-full border px-4 py-3",
    "border-border/55 bg-popover/95 text-popover-foreground shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] backdrop-blur-xl",
    "ring-1 ring-black/[0.04] dark:border-border/50 dark:bg-popover/90 dark:shadow-[0_12px_48px_-12px_rgba(0,0,0,0.45)] dark:ring-white/[0.06]",
  ),
  content: "flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-0.5 self-center",
  title: "text-sm font-medium leading-normal tracking-tight text-foreground",
  description: "text-xs leading-normal text-muted-foreground",
  icon: cn(
    "m-0 flex size-10 shrink-0 items-center justify-center rounded-full border border-border/45",
    "bg-muted/50 shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--background)_35%,transparent)] [&_svg]:block [&_svg]:size-5 [&_svg]:shrink-0",
  ),
  actionButton: cn(
    "h-8 shrink-0 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground",
    "transition-[transform,background-color,box-shadow] duration-200 ease-out hover:bg-primary/88 active:scale-[0.98]",
  ),
  cancelButton: cn(
    "h-8 shrink-0 rounded-full border border-border/60 bg-muted/40 px-3.5 text-xs font-medium text-muted-foreground",
    "transition-[transform,background-color,color] duration-200 ease-out hover:border-border hover:bg-muted/70 hover:text-foreground active:scale-[0.98]",
  ),
};

const Toaster = ({ toastOptions, className, ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-center"
      offset={{ bottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
      mobileOffset={16}
      visibleToasts={4}
      gap={14}
      expand={false}
      richColors
      closeButton={false}
      className={cn("toaster group pointer-events-auto", className)}
      icons={{
        success: <CircleCheckIcon className="size-5 text-emerald-600 dark:text-emerald-400" />,
        info: <InfoIcon className="size-5 text-sky-600 dark:text-sky-400" />,
        warning: <TriangleAlertIcon className="size-5 text-amber-600 dark:text-amber-400" />,
        error: <OctagonXIcon className="size-5 text-rose-600 dark:text-rose-400" />,
        loading: <Loader2Icon className="size-5 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "9999px",
        } as React.CSSProperties
      }
      toastOptions={{
        duration: 3200,
        ...toastOptions,
        classNames: {
          ...defaultToastClassNames,
          ...toastOptions?.classNames,
          toast: cn(defaultToastClassNames.toast, toastOptions?.classNames?.toast),
          content: cn(defaultToastClassNames.content, toastOptions?.classNames?.content),
          title: cn(defaultToastClassNames.title, toastOptions?.classNames?.title),
          description: cn(
            defaultToastClassNames.description,
            toastOptions?.classNames?.description,
          ),
          icon: cn(defaultToastClassNames.icon, toastOptions?.classNames?.icon),
          actionButton: cn(
            defaultToastClassNames.actionButton,
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            defaultToastClassNames.cancelButton,
            toastOptions?.classNames?.cancelButton,
          ),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

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
      offset={18}
      visibleToasts={3}
      gap={5}
      expand={false}
      richColors={false}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-3" />,
        info: <InfoIcon className="size-3" />,
        warning: <TriangleAlertIcon className="size-3" />,
        error: <OctagonXIcon className="size-3" />,
        loading: <Loader2Icon className="size-3 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "999px",
        } as React.CSSProperties
      }
      toastOptions={{
        duration: 2200,
        classNames: {
          toast:
            "cn-toast min-h-0 w-fit max-w-[min(88vw,320px)] rounded-full border bg-popover/95 px-3 py-1.5 text-popover-foreground shadow-lg shadow-foreground/8 ring-1 ring-foreground/5 backdrop-blur-xl transition-all duration-150 ease-out dark:border-border/80 dark:bg-popover/90 dark:shadow-black/25 dark:ring-white/5",
          title: "text-xs font-medium leading-4 tracking-normal",
          description: "text-[11px] leading-4 text-muted-foreground",
          icon: "mr-1 text-muted-foreground",
          actionButton:
            "h-6 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/85",
          cancelButton:
            "h-6 rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

import { Loader2Icon, Trash2Icon } from "lucide-react";
import * as React from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HOLD_DURATION_MS = 900;

interface HoldToDeleteProps {
  children: React.ReactNode;
  disabled?: boolean;
  isPending?: boolean;
  className?: string;
  mode?: "button" | "menu-item";
  onDelete: () => void;
}

export function HoldToDelete({
  children,
  disabled = false,
  isPending = false,
  className,
  mode = "button",
  onDelete,
}: HoldToDeleteProps) {
  const [isHolding, setIsHolding] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  const completedRef = React.useRef(false);
  const isDisabled = disabled || isPending;

  const clearHold = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    completedRef.current = false;
    setIsHolding(false);
  }, []);

  const startHold = React.useCallback(() => {
    if (isDisabled || timerRef.current !== null) {
      return;
    }

    completedRef.current = false;
    setIsHolding(true);
    timerRef.current = window.setTimeout(() => {
      completedRef.current = true;
      timerRef.current = null;
      setIsHolding(false);
      onDelete();
    }, HOLD_DURATION_MS);
  }, [isDisabled, onDelete]);

  const stopHold = React.useCallback(() => {
    if (!completedRef.current) {
      clearHold();
    }
  }, [clearHold]);

  React.useEffect(() => clearHold, [clearHold]);

  const sharedProps = {
    type: "button" as const,
    disabled: isDisabled,
    "aria-label": typeof children === "string" ? `Hold to ${children.toLowerCase()}` : undefined,
    onPointerDown: startHold,
    onPointerLeave: stopHold,
    onPointerCancel: stopHold,
    onPointerUp: stopHold,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      startHold();
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      stopHold();
    },
  };

  const content = (
    <>
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-md bg-destructive/15 transition-[width] ease-linear",
          isHolding ? "w-full" : "w-0",
        )}
        style={{ transitionDuration: isHolding ? `${HOLD_DURATION_MS}ms` : "120ms" }}
        aria-hidden="true"
      />
      <span className="relative z-10 inline-flex items-center gap-2">
        {isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <Trash2Icon className="size-4" />
        )}
        {isHolding ? "Hold..." : children}
      </span>
    </>
  );

  if (mode === "menu-item") {
    return (
      <button
        {...sharedProps}
        className={cn(
          "relative flex w-full cursor-default items-center overflow-hidden rounded-md px-2.5 py-2 text-left text-sm font-medium text-destructive outline-hidden select-none focus:bg-destructive/10 focus:text-destructive disabled:pointer-events-none disabled:opacity-50 dark:focus:bg-destructive/20",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      {...sharedProps}
      className={cn(
        buttonVariants({ variant: "destructive" }),
        "relative overflow-hidden",
        className,
      )}
    >
      {content}
    </button>
  );
}

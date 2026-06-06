import * as React from "react";
import { cn } from "@/lib/utils";

/** Standardized async-state primitives so every screen looks the same.
 *  Loading = quiet line (pair with <Skeleton> for content shapes).
 *  Empty   = full-width card + a next-step CTA.
 *  Error   = red card with the message. */

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-zinc-500", className)} role="status" aria-live="polite">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-gold" />
      {label}
    </div>
  );
}

export function Empty({
  icon = "✨",
  title,
  hint,
  action,
  className,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-bg-graphite bg-bg-ink p-8 text-center",
        className,
      )}
    >
      <div className="text-2xl" aria-hidden>{icon}</div>
      <p className="mt-2 text-sm text-zinc-300">{title}</p>
      {hint && <p className="mt-1 text-2xs text-zinc-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, className }: { error: unknown; className?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div
      className={cn(
        "rounded-card border border-danger/40 bg-danger/10 p-5 text-sm text-red-200",
        className,
      )}
      role="alert"
    >
      {msg}
    </div>
  );
}

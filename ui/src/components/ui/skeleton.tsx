import * as React from "react";
import { cn } from "@/lib/utils";

/** Shimmer placeholder. Use instead of "Loading…" text on content surfaces. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-card", className)} aria-hidden />;
}

/** N stacked card-shaped skeleton rows — matches list layouts. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-card border border-bg-graphite bg-bg-ink p-4">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

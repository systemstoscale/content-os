import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-1 text-2xs font-medium uppercase tracking-widest",
  {
    variants: {
      tone: {
        // Maps to draft.status visually — keep these intentional.
        pending: "border-gold/40 bg-gold/10 text-gold",
        approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
        published: "border-emerald-500/60 bg-emerald-500/20 text-emerald-200",
        rejected: "border-zinc-600 bg-zinc-800 text-zinc-400",
        failed: "border-red-500/40 bg-red-500/10 text-red-300",
        neutral: "border-bg-graphite bg-bg-charcoal text-zinc-300",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

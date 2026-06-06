import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-card text-sm font-display uppercase tracking-wider transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
  {
    variants: {
      variant: {
        primary: "bg-gold text-black hover:bg-gold/90",
        secondary: "border border-bg-graphite bg-bg-ink text-white hover:border-gold/60",
        ghost: "text-zinc-300 hover:text-white",
        danger: "border border-red-500/40 bg-red-500/10 text-red-200 hover:border-red-500/80",
      },
      size: {
        // Heights meet the 44px mobile touch-target minimum (md is the default).
        sm: "h-9 px-3",
        md: "h-11 px-4",
        lg: "h-12 px-6",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

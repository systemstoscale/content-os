import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  "w-full rounded-card border border-bg-graphite bg-bg-ink text-white placeholder-zinc-600 transition focus:border-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-50",
  {
    variants: {
      // Heights match the Button scale so inputs + buttons align on a row.
      inputSize: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-3 text-sm",
        lg: "h-12 px-4 text-base",
      },
    },
    defaultVariants: { inputSize: "md" },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize, ...props }, ref) => (
    <input ref={ref} className={cn(inputVariants({ inputSize }), className)} {...props} />
  ),
);
Input.displayName = "Input";

/** Multiline variant — same skin, auto-height friendly. */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-card border border-bg-graphite bg-bg-ink px-3 py-2 text-sm text-white placeholder-zinc-600 transition focus:border-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-[0.04em]",
  {
    variants: {
      variant: {
        brand: "border-brand/25 bg-brand-soft text-brand",
        neutral: "border-line bg-panel-soft text-muted",
        indigo:
          "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
        olive:
          "border-lime-700/20 bg-lime-700/10 text-lime-700 dark:text-lime-300",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

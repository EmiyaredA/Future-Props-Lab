import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-line bg-panel text-ink shadow-sm hover:-translate-y-px hover:border-brand/45 hover:text-brand",
        brand:
          "bg-brand text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_25%,transparent)] hover:-translate-y-px hover:bg-brand-strong",
        ghost: "text-muted hover:bg-panel-soft hover:text-ink",
        soft: "bg-brand-soft text-brand hover:bg-brand-soft/75",
      },
      size: {
        sm: "min-h-8 px-3 text-xs",
        md: "min-h-10 px-4",
        lg: "min-h-11 px-5",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

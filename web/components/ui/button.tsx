// SPDX-License-Identifier: Apache-2.0
// shadcn/ui button, themed to the SolVerdict dark palette (no radix dep).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sol-purple disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-sol-purple/90 text-white hover:bg-sol-purple",
        secondary: "border border-border bg-panel text-text-strong hover:border-sol-purple/60 hover:bg-panel-2",
        ghost: "text-muted hover:bg-panel hover:text-text-strong",
        outline: "border border-border bg-transparent text-text hover:border-sol-purple/60 hover:text-text-strong",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 rounded px-2 text-xs",
        lg: "h-10 px-5",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };

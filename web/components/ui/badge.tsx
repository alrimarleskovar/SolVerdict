// SPDX-License-Identifier: Apache-2.0
// shadcn/ui badge with SolVerdict verdict-tier variants.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "border-border bg-panel text-text",
        pass: "border-sol-green/40 bg-sol-green/10 text-sol-green",
        fail: "border-sol-red/40 bg-sol-red/10 text-sol-red",
        partial: "border-sol-purple/40 bg-sol-purple/10 text-purple-soft",
        muted: "border-border bg-panel-2 text-muted",
        outline: "border-border bg-transparent text-text",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

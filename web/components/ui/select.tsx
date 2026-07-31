// SPDX-License-Identifier: Apache-2.0
// Styled native select (shadcn look without the radix dependency — the
// explorer's filters are simple enough that native semantics win).
import * as React from "react";
import { cn } from "../../lib/utils";

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 rounded-md border border-border bg-panel-2 px-2 pr-7 text-sm text-text-strong focus-visible:border-sol-purple/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sol-purple/40",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export { Select };

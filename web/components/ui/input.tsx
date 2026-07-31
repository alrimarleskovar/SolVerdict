// SPDX-License-Identifier: Apache-2.0
// shadcn/ui input on the panel palette.
import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full rounded-md border border-border bg-panel-2 px-3 py-1 text-sm text-text-strong placeholder:text-muted focus-visible:border-sol-purple/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sol-purple/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };

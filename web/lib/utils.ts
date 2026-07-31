// SPDX-License-Identifier: Apache-2.0
// shadcn/ui convention: cn() merges conditional class lists and resolves
// Tailwind conflicts (later classes win).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// SPDX-License-Identifier: Apache-2.0
/**
 * SolVerdict mark — original design, not derived from any existing logo.
 *
 * Concept: a security shield whose interior is three "layers" in the spirit of
 * Solana's stacked-bar motif — top and bottom layers are skewed bars, and the
 * MIDDLE layer is a checkmark: verification as a first-class layer of the
 * stack. Reads as: wallet security (shield) + Solana (layers) + verified
 * containment (check).
 *
 * Variants:
 *  - "color": blue→cyan layer gradient, green check (dark or light bg)
 *  - "mono":  everything currentColor (favicons, docs, single-color contexts)
 */
"use client";

import { useId } from "react";

export interface LogoProps {
  size?: number;
  variant?: "color" | "mono";
  className?: string;
  title?: string;
}

export function SolVerdictLogo({ size = 28, variant = "color", className, title = "SolVerdict" }: LogoProps) {
  const uid = useId();
  const barsId = `sv-bars-${uid}`;
  const rimId = `sv-rim-${uid}`;
  const color = variant === "color";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      {color && (
        <defs>
          <linearGradient id={barsId} x1="14" y1="13" x2="34" y2="35" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#06B6D4" />
          </linearGradient>
          <linearGradient id={rimId} x1="7" y1="4" x2="41" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
      )}

      {/* shield */}
      <path
        d="M24 3.5 40.5 9.9 v12.7 c0 10.3-6.9 17.9-16.5 21.9 C14.4 40.5 7.5 32.9 7.5 22.6 V9.9 Z"
        fill={color ? "rgba(59, 130, 246, 0.07)" : "none"}
        stroke={color ? `url(#${rimId})` : "currentColor"}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {/* top layer (skewed bar, leaning left) */}
      <path d="M18 14.2 h13.4 l-3.4 3.8 H14.6 Z" fill={color ? `url(#${barsId})` : "currentColor"} />

      {/* bottom layer (skewed bar, leaning right) */}
      <path d="M14.6 30.4 h13.4 l3.4 3.8 H18 Z" fill={color ? `url(#${barsId})` : "currentColor"} />

      {/* middle layer: the verification check */}
      <path
        d="M15.6 24.1 l5.5 5 L32.6 18.9"
        stroke={color ? "#22C55E" : "currentColor"}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Wordmark: mark + name, for the navbar and footer. */
export function SolVerdictWordmark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <SolVerdictLogo size={size} />
      <span className="font-display text-[1.05rem] font-semibold tracking-tight text-snow">SolVerdict</span>
    </span>
  );
}

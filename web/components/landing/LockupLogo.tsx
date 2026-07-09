// SPDX-License-Identifier: Apache-2.0
/**
 * SolVerdict brand components — vendored from solverdict-assets/react/BrandLogo.tsx
 * (the canonical source). Exports SymbolLogo and LockupLogo.
 *
 * ONE local adaptation vs. the canonical file: the wordmark/tagline font-family
 * is `var(--font-exo), Exo, sans-serif` instead of `Exo, sans-serif`. This app
 * self-hosts Exo via next/font (app/layout.tsx), which exposes it under a hashed
 * family name reachable only through the --font-exo CSS variable — a literal
 * "Exo" would silently fall back to the system sans. The `Exo` literal is kept
 * as a secondary fallback for any context that loads Exo by its real name.
 *
 * The tagline ("AI AGENT SECURITY BENCHMARK") sits at font-size 32 inside a
 * 440-unit-tall viewBox. Below roughly 80px of rendered height it collapses
 * into an illegible grey smear, so `showTagline` defaults to false and the
 * viewBox is cropped accordingly. Navbar and footer keep the default.
 *
 * Gradients use userSpaceOnUse with absolute coordinates so that every variant
 * — symbol, compact lockup, full lockup — samples the exact same slice of the
 * gradient. Do not switch to objectBoundingBox: the symbol would re-map the
 * gradient to its own bounds and drift away from the wordmark.
 *
 * IDs are suffixed with a `useId()` value because multiple instances on one
 * page would otherwise collide on `#g` / `#text-g` and inherit each other's
 * gradient definitions.
 */
"use client";

import { useId } from "react";

// Wordmark/tagline family: self-hosted Exo (next/font var), then the literal
// Exo name, then system sans. See the header comment for why the var is first.
const EXO_FAMILY = "var(--font-exo), Exo, sans-serif";

const GRADIENT_STOPS = [
  { offset: "0%", color: "#00E59A" },
  { offset: "25%", color: "#00E59A" },
  { offset: "35%", color: "#00C2FF" },
  { offset: "48%", color: "#00C2FF" },
  { offset: "58%", color: "#4673FA" },
  { offset: "75%", color: "#4673FA" },
  { offset: "85%", color: "#7B5CFF" },
  { offset: "94%", color: "#D946EF" },
  { offset: "100%", color: "#D946EF" },
] as const;

const TEXT_STOPS = [
  { offset: "0%", color: "#00E59A" },
  { offset: "50%", color: "#00C2FF" },
  { offset: "100%", color: "#4673FA" },
] as const;

/** The shield, hollow circuit nodes, connector shapes and the check mark. */
function SymbolPaths({ gradId, hollow }: { gradId: string; hollow: boolean }) {
  // When rendered over a known dark surface, filling the circles with the
  // surface color keeps them reading as hollow rings. Over an unknown or
  // transparent background, fill="none" lets the backdrop show through.
  const circleFill = hollow ? "none" : "#0B0F14";
  return (
    <>
      <path
        d="M 513.21 224.26 L 513.21 140 L 340 40 L 166.79 140 L 166.79 322.68 A 30 30 0 0 0 181.79 348.66 L 340 440 L 498.21 348.66 A 30 30 0 0 0 513.21 322.68 L 513.21 264.26"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="20"
        strokeLinejoin="miter"
      />
      <path
        d="M 398.89 356.0 L 343.46 388.0 M 336.54 388.0 L 210.10 315 L 210.10 165 L 299.73 113.25"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="12"
        strokeLinejoin="miter"
      />
      <circle cx="340" cy="390" r="7" fill={circleFill} stroke={`url(#${gradId})`} strokeWidth="6" />
      <circle cx="404.95" cy="352.5" r="10" fill={circleFill} stroke={`url(#${gradId})`} strokeWidth="6" />
      <circle cx="307.525" cy="108.75" r="12" fill={circleFill} stroke={`url(#${gradId})`} strokeWidth="6" />
      <polygon points="500,266 500,306 546,286 546,246" fill={`url(#${gradId})`} />
      <polygon points="498.04,226.75 527.96,213.74 527.96,239.75 498.04,252.76" fill={`url(#${gradId})`} />
      <path
        d="M 288 233 L 338 285 L 440 178"
        fill="none"
        stroke="#00E59A"
        strokeWidth="26"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </>
  );
}

function BrandGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="150" y1="0" x2="530" y2="480" gradientUnits="userSpaceOnUse">
      {GRADIENT_STOPS.map((s) => (
        <stop key={s.offset} offset={s.offset} stopColor={s.color} />
      ))}
    </linearGradient>
  );
}

function TextGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="800" y1="170" x2="1300" y2="310" gradientUnits="userSpaceOnUse">
      {TEXT_STOPS.map((s) => (
        <stop key={s.offset} offset={s.offset} stopColor={s.color} />
      ))}
    </linearGradient>
  );
}

type SvgProps = React.SVGProps<SVGSVGElement>;

/** Square symbol only. Safe down to 16px. */
export function SymbolLogo({ hollow = true, ...props }: SvgProps & { hollow?: boolean }) {
  const uid = useId();
  const gradId = `sv-g-${uid}`;
  return (
    <svg viewBox="120 20 440 440" role="img" aria-label="SolVerdict" {...props}>
      <defs>
        <BrandGradient id={gradId} />
      </defs>
      <SymbolPaths gradId={gradId} hollow={hollow} />
    </svg>
  );
}

/**
 * Symbol + wordmark, optionally + tagline.
 *
 * `showTagline` requires >= ~80px of rendered height to stay legible.
 * The wordmark is re-centred on the symbol when the tagline is hidden.
 */
export function LockupLogo({
  showTagline = false,
  hollow = true,
  ...props
}: SvgProps & { showTagline?: boolean; hollow?: boolean }) {
  const uid = useId();
  const gradId = `sv-g-${uid}`;
  const textGradId = `sv-tg-${uid}`;

  const viewBox = showTagline ? "120 20 1400 440" : "120 20 1240 440";
  const wordmarkY = showTagline ? 220 : 240;

  return (
    <svg viewBox={viewBox} role="img" aria-label="SolVerdict" {...props}>
      <defs>
        <BrandGradient id={gradId} />
        <TextGradient id={textGradId} />
      </defs>
      <SymbolPaths gradId={gradId} hollow={hollow} />
      <text
        x="600"
        y={wordmarkY}
        fontSize="155"
        fontFamily={EXO_FAMILY}
        fontWeight="500"
        dominantBaseline="middle"
      >
        <tspan fill="#FFFFFF">Sol</tspan>
        <tspan fill={`url(#${textGradId})`}>Verdict</tspan>
      </text>
      {showTagline && (
        <text
          x="600"
          y="330"
          fontSize="32"
          fontFamily={EXO_FAMILY}
          fontWeight="400"
          fill="#B0BCC9"
          textLength="720"
          lengthAdjust="spacing"
          dominantBaseline="middle"
        >
          AI AGENT SECURITY BENCHMARK
        </text>
      )}
    </svg>
  );
}

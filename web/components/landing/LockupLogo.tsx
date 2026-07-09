// SPDX-License-Identifier: Apache-2.0
/**
 * SolVerdict brand components.
 *
 * PROPORTION. The symbol fills the full 440-unit height of its native artboard
 * while the wordmark's cap-height is only ~112 of those units — a ratio of 0.27,
 * which reads as a wordmark tacked onto a shield. Horizontal lockups want 0.45–0.55.
 * So the symbol is scaled to 0.4762 inside a 920×240 box, the wordmark set at 140,
 * and the ratio lands at 0.50. The symbol keeps its own coordinate system inside a
 * transformed <g>, which means the gradient (userSpaceOnUse) is carried along by the
 * same transform and still samples the identical slice of color.
 *
 * TAGLINE. At font-size 32 in a 440-tall artboard the tagline is 7.3% of the height.
 * Rendered at 30px that's 2.2px of text. It needs ~56px of lockup height before an
 * all-caps line becomes legible, which no navbar affords. `showTagline` defaults to
 * false; reserve it for the footer, the hero and the OG image.
 *
 * CHECK REVEAL. `revealCheck` hides the check via stroke-dashoffset and draws it in
 * on hover. The empty shield reads as an audit not yet run; the stroke completing is
 * the verdict landing. Honors prefers-reduced-motion by falling back to opacity.
 *
 * IDS. Gradient ids are suffixed with useId() — two instances on a page would
 * otherwise collide on `#g` and silently inherit each other's definitions.
 */
"use client";

import { useId } from "react";

/** Path length of "M 288 233 L 338 285 L 440 178" — 72.1 + 147.8. */
const CHECK_LENGTH = 220;

/** Maps the symbol's native artboard into the 920×240 lockup box at 0.4762 scale. */
const SYMBOL_TRANSFORM = "translate(-54.66, 5.71) scale(0.4762)";

const BRAND_STOPS = [
  ["0%", "#00E59A"],
  ["25%", "#00E59A"],
  ["35%", "#00C2FF"],
  ["48%", "#00C2FF"],
  ["58%", "#4673FA"],
  ["75%", "#4673FA"],
  ["85%", "#7B5CFF"],
  ["94%", "#D946EF"],
  ["100%", "#D946EF"],
] as const;

function BrandGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="150" y1="0" x2="530" y2="480" gradientUnits="userSpaceOnUse">
      {BRAND_STOPS.map(([offset, color]) => (
        <stop key={offset} offset={offset} stopColor={color} />
      ))}
    </linearGradient>
  );
}

/** Wordmark gradient, remapped from the native artboard to the 920×240 box. */
function WordmarkGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="425" y1="60" x2="895" y2="180" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#00E59A" />
      <stop offset="50%" stopColor="#00C2FF" />
      <stop offset="100%" stopColor="#4673FA" />
    </linearGradient>
  );
}

/**
 * Scoped CSS for the hover reveal. Inlined rather than a Tailwind arbitrary
 * variant so the component stays portable to any consumer.
 */
function RevealStyle({ scope }: { scope: string }) {
  return (
    <style>{`
      .${scope} .sv-check {
        stroke-dasharray: ${CHECK_LENGTH};
        stroke-dashoffset: ${CHECK_LENGTH};
        transition: stroke-dashoffset 450ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .${scope}:hover .sv-check,
      .${scope}:focus-visible .sv-check {
        stroke-dashoffset: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .${scope} .sv-check {
          stroke-dasharray: none;
          stroke-dashoffset: 0;
          opacity: 0;
          transition: opacity 150ms linear;
        }
        .${scope}:hover .sv-check,
        .${scope}:focus-visible .sv-check {
          opacity: 1;
        }
      }
    `}</style>
  );
}

function SymbolPaths({ gradId, hollow }: { gradId: string; hollow: boolean }) {
  // Over a known dark surface, filling the nodes with that surface keeps them
  // reading as rings. Over an unknown backdrop, none lets it show through.
  const nodeFill = hollow ? "none" : "#0B0F14";
  const stroke = `url(#${gradId})`;
  return (
    <>
      <path
        d="M 513.21 224.26 L 513.21 140 L 340 40 L 166.79 140 L 166.79 322.68 A 30 30 0 0 0 181.79 348.66 L 340 440 L 498.21 348.66 A 30 30 0 0 0 513.21 322.68 L 513.21 264.26"
        fill="none"
        stroke={stroke}
        strokeWidth="20"
        strokeLinejoin="miter"
      />
      <path
        d="M 398.89 356.0 L 343.46 388.0 M 336.54 388.0 L 210.10 315 L 210.10 165 L 299.73 113.25"
        fill="none"
        stroke={stroke}
        strokeWidth="12"
        strokeLinejoin="miter"
      />
      <circle cx="340" cy="390" r="7" fill={nodeFill} stroke={stroke} strokeWidth="6" />
      <circle cx="404.95" cy="352.5" r="10" fill={nodeFill} stroke={stroke} strokeWidth="6" />
      <circle cx="307.525" cy="108.75" r="12" fill={nodeFill} stroke={stroke} strokeWidth="6" />
      <polygon points="500,266 500,306 546,286 546,246" fill={stroke} />
      <polygon points="498.04,226.75 527.96,213.74 527.96,239.75 498.04,252.76" fill={stroke} />
      <path
        className="sv-check"
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

type SvgProps = React.SVGProps<SVGSVGElement>;
type BrandProps = SvgProps & { hollow?: boolean; revealCheck?: boolean };

/** Square symbol. Legible down to 16px. */
export function SymbolLogo({ hollow = true, revealCheck = false, className, ...props }: BrandProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `sv-g-${uid}`;
  const scope = `sv-rv-${uid}`;
  return (
    <svg
      viewBox="120 20 440 440"
      role="img"
      aria-label="SolVerdict"
      className={[revealCheck ? scope : "", className].filter(Boolean).join(" ")}
      {...props}
    >
      <defs>
        <BrandGradient id={gradId} />
      </defs>
      {revealCheck && <RevealStyle scope={scope} />}
      <SymbolPaths gradId={gradId} hollow={hollow} />
    </svg>
  );
}

/**
 * Symbol + wordmark, optionally + tagline.
 * `showTagline` needs >= ~56px of rendered height. Navbar and footer keep it off.
 */
export function LockupLogo({
  showTagline = false,
  hollow = true,
  revealCheck = false,
  className,
  ...props
}: BrandProps & { showTagline?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `sv-g-${uid}`;
  const textGradId = `sv-tg-${uid}`;
  const scope = `sv-rv-${uid}`;

  const wordmarkY = showTagline ? 98 : 120;
  const wordmarkSize = showTagline ? 120 : 140;

  return (
    <svg
      viewBox="0 0 920 240"
      role="img"
      aria-label="SolVerdict — AI Agent Security Benchmark"
      className={[revealCheck ? scope : "", className].filter(Boolean).join(" ")}
      {...props}
    >
      <defs>
        <BrandGradient id={gradId} />
        <WordmarkGradient id={textGradId} />
      </defs>
      {revealCheck && <RevealStyle scope={scope} />}
      <g transform={SYMBOL_TRANSFORM}>
        <SymbolPaths gradId={gradId} hollow={hollow} />
      </g>
      <text
        x="245"
        y={wordmarkY}
        fontSize={wordmarkSize}
        fontFamily="var(--font-exo), Exo, sans-serif"
        fontWeight="500"
        dominantBaseline="middle"
      >
        <tspan fill="#FFFFFF">Sol</tspan>
        <tspan fill={`url(#${textGradId})`}>Verdict</tspan>
      </text>
      {showTagline && (
        <text
          x="247"
          y="170"
          fontSize="34"
          fontFamily="var(--font-exo), Exo, sans-serif"
          fontWeight="400"
          fill="#B0BCC9"
          textLength="560"
          lengthAdjust="spacing"
          dominantBaseline="middle"
        >
          AI AGENT SECURITY BENCHMARK
        </text>
      )}
    </svg>
  );
}

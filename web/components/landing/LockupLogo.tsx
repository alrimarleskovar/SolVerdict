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
 * THE HANDOFF. `revealCheck` used to be mutually exclusive with the landing's
 * opening sequence, which ends by flying a completed check into this mark and so
 * needed the check already drawn here to land on — hence `alwaysShowCheck`, which
 * bought the landing its payoff at the cost of the hover reveal everywhere on that
 * page. The two only conflicted because one was a STATIC choice and the requirement
 * is TEMPORAL: drawn at the moment of the handoff, idle-and-hoverable after it.
 *
 * So a consumer can add the class `sv-check-held` to a revealCheck instance to run a
 * one-shot animation that holds the check drawn and then lets it recede to the
 * resting state. It is a CSS animation rather than a JS-toggled class on purpose:
 * the intro unmounts moments after triggering it, and a timer owned by an
 * unmounting component either gets cleaned up early or has to outlive its own
 * cleanup. The animation ends on its own with fill-mode `none`, so the property
 * falls back to the cascade and `:hover` is authoritative again — nothing has to
 * remove the class.
 *
 * IDS. Gradient ids are suffixed with useId() — two instances on a page would
 * otherwise collide on `#g` and silently inherit each other's definitions.
 */
"use client";

import { useId } from "react";

/**
 * Path length of "M 288 233 L 338 285 L 440 178" — 72.1 + 147.8.
 * Exported so a consumer driving the same `.sv-check` path from its own
 * stroke-dashoffset animation (the landing intro) cannot drift from the
 * geometry here if the path is ever redrawn.
 */
export const CHECK_LENGTH = 220;

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
function RevealStyle({ scope, uid }: { scope: string; uid: string }) {
  // Per-instance keyframes name: two logos on a page would otherwise share one
  // @keyframes, for the same reason the gradient ids are suffixed.
  const handoff = `sv-handoff-${uid}`;
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

      /* THE HANDOFF. Drawn through the fly-in and held, then receding to the
         resting state — which is itself the right reading: the verdict was for
         THAT run, and the header shield goes idle again, ready to be hovered.
         The hold runs from the START of the morph (that is when the consumer
         adds the class), so 65% of 2800ms leaves ~1.3s of held check AFTER the
         550ms fly-in completes, before the ~1s recession begins.
         No fill-mode: at the end the property reverts to the cascade above,
         which is the same value the keyframe finishes on — no flash — and
         :hover stops being outranked by a running animation. */
      @keyframes ${handoff} {
        0%, 65% { stroke-dashoffset: 0; }
        100%    { stroke-dashoffset: ${CHECK_LENGTH}; }
      }
      .${scope}.sv-check-held .sv-check {
        animation: ${handoff} 2800ms cubic-bezier(0.4, 0, 0.2, 1);
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
        /* dasharray is none here, so the handoff would animate nothing while
           opacity kept it invisible. Nothing triggers it under reduced motion
           anyway — the intro never morphs — but an animation that cannot work
           should not be left armed. */
        .${scope}.sv-check-held .sv-check { animation: none; }
      }

      /* Touch devices have no hover state. Reveal is a desktop enhancement —
         on touch the check is simply present. The handoff is disabled with it:
         a tablet is wide enough for the intro to run the morph, and a check
         that receded there could never be brought back. */
      @media (hover: none), (pointer: coarse) {
        .${scope} .sv-check { stroke-dashoffset: 0; }
        .${scope}.sv-check-held .sv-check { animation: none; }
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
      {revealCheck && <RevealStyle scope={scope} uid={uid} />}
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

  // Baselines are explicit rather than dominant-baseline="middle": WebKit
  // (Safari, and any iOS browser) implements that attribute inconsistently and
  // shifts the wordmark upward relative to the symbol.
  const wordmarkY = showTagline ? 141 : 170;
  const wordmarkSize = showTagline ? 120 : 140;

  return (
    <svg
      viewBox="0 0 920 240"
      role="img"
      aria-label="SolVerdict — AI Agent Security Benchmark"
      className={[revealCheck ? scope : "", className].filter(Boolean).join(" ")}
      {...props}
      // Force an own compositing layer: WebKit drops SVG paint servers
      // (fill="url(#id)") when a sticky ancestor composites during scroll,
      // blanking the wordmark gradient. translateZ pins the layer.
      style={{ transform: "translateZ(0)", ...props.style }}
    >
      <defs>
        <BrandGradient id={gradId} />
        <WordmarkGradient id={textGradId} />
      </defs>
      {revealCheck && <RevealStyle scope={scope} uid={uid} />}
      <g transform={SYMBOL_TRANSFORM}>
        <SymbolPaths gradId={gradId} hollow={hollow} />
      </g>
      <text
        x="245"
        y={wordmarkY}
        fontSize={wordmarkSize}
        fontFamily="var(--font-exo), Exo, sans-serif"
        fontWeight="500"
      >
        <tspan fill="#FFFFFF">Sol</tspan>
        {/* Second value is an SVG 1.1 fallback: if the paint server fails to
            resolve (WebKit scroll compositing), the text falls back to solid
            cyan instead of rendering invisible. */}
        <tspan fill={`url(#${textGradId}) #00C2FF`}>Verdict</tspan>
      </text>
      {showTagline && (
        <text
          x="247"
          y="185"
          fontSize="34"
          fontFamily="var(--font-exo), Exo, sans-serif"
          fontWeight="400"
          fill="#B0BCC9"
          textLength="560"
          lengthAdjust="spacing"
        >
          AI AGENT SECURITY BENCHMARK
        </text>
      )}
    </svg>
  );
}

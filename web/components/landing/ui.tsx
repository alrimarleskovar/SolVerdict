// SPDX-License-Identifier: Apache-2.0
/**
 * Shared landing primitives + the motion tokens (single source of truth):
 * fast 200ms · normal 350ms · slow 600ms, one easing curve, no springs.
 * All motion respects prefers-reduced-motion.
 */
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

export const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
export const DUR = { fast: 0.2, normal: 0.35, slow: 0.6 } as const;

/** Fade-up on scroll into view (once). */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: DUR.normal, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Eyebrow + display heading — the one dominant hierarchy per section.
 *  `as="h1"` lets inner pages use it as their page heading (landing keeps h2). */
export function SectionHeading({
  eyebrow,
  title,
  as: Tag = "h2",
  className,
}: {
  eyebrow: string;
  title: string;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <Reveal className={className}>
      <p className="font-code text-[13px] uppercase tracking-[0.2em] text-accent-cyan">{eyebrow}</p>
      <Tag className="mt-3 max-w-2xl font-display text-[28px] font-bold leading-[1.15] tracking-tight text-snow sm:text-[40px]">
        {title}
      </Tag>
    </Reveal>
  );
}

/** Animated count-up once in view; renders the final value under reduced motion. */
export function Counter({ value, suffix = "", duration = DUR.slow }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: EASE });
    return () => controls.stop();
  }, [inView, reduced, value, duration, mv]);

  return (
    <span ref={ref}>
      <motion.span>{rounded}</motion.span>
    </span>
  );
}

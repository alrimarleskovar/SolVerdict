// SPDX-License-Identifier: Apache-2.0
/** Shared landing primitives: scroll reveals, section headings, count-up
 *  numbers. All motion respects prefers-reduced-motion. */
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

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
      initial={reduced ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.21, 0.65, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Eyebrow + display heading, the rhythm every section shares. */
export function SectionHeading({ eyebrow, title, className }: { eyebrow: string; title: string; className?: string }) {
  return (
    <Reveal className={className}>
      <p className="font-code text-xs uppercase tracking-[0.2em] text-accent-cyan">{eyebrow}</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-snow sm:text-4xl">{title}</h2>
    </Reveal>
  );
}

/** Animated count-up once in view; renders the final value under reduced motion. */
export function Counter({ value, suffix = "", duration = 1.4 }: { value: number; suffix?: string; duration?: number }) {
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
    const controls = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [inView, reduced, value, duration, mv]);

  return (
    <span ref={ref}>
      <motion.span>{rounded}</motion.span>
    </span>
  );
}

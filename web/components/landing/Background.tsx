// SPDX-License-Identifier: Apache-2.0
/**
 * Ambient landing background: blurred gradient orbs with gentle mouse
 * parallax, a masked dot grid, and a lightweight particle field with
 * connection lines. Everything is subtle by design and fully disabled for
 * prefers-reduced-motion. The canvas pauses when the tab is hidden and caps
 * devicePixelRatio at 2 to stay cheap.
 */
"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const PARTICLE_COUNT = 42;
const LINK_DIST = 130;

function Particles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let particles: Particle[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particles.length === 0) {
        particles = Array.from({ length: PARTICLE_COUNT }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
        }));
      }
    };

    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      // connection lines between nearby particles
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            ctx.strokeStyle = `rgba(59, 130, 246, ${(0.14 * (1 - d / LINK_DIST)).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    };

    resize();
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  if (reduced) return null;
  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-60" aria-hidden="true" />;
}

/** Hero-area background: parallax orbs + dot grid + particles. */
export function HeroBackground() {
  const reduced = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 40, damping: 20 });
  const sy = useSpring(my, { stiffness: 40, damping: 20 });
  const blueX = useTransform(sx, (v) => v * 30);
  const blueY = useTransform(sy, (v) => v * 22);
  const violetX = useTransform(sx, (v) => v * -22);
  const violetY = useTransform(sy, (v) => v * -16);

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: MouseEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [mx, my, reduced]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[920px] overflow-hidden" aria-hidden="true">
      <div className="landing-grid" />
      <motion.div
        className="landing-orb h-[560px] w-[560px] bg-accent-blue/25 -top-40 left-[8%]"
        style={{ x: blueX, y: blueY }}
      />
      <motion.div
        className="landing-orb h-[480px] w-[480px] bg-accent-violet/20 top-24 right-[4%]"
        style={{ x: violetX, y: violetY }}
      />
      <div className="landing-orb h-[380px] w-[380px] bg-accent-cyan/10 top-[420px] left-[38%]" />
      <Particles />
      {/* fade the effects out into the page background */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-ink" />
    </div>
  );
}

/** Quiet single-orb glow for deep-page sections (no canvas, no listeners). */
export function SectionGlow({ className }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`} aria-hidden="true">
      <div className="landing-orb h-[420px] w-[620px] bg-accent-blue/10 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}

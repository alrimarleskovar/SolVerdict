// SPDX-License-Identifier: Apache-2.0
/**
 * Ambient background: a masked dot grid, two static very-subtle orbs, and a
 * slow particle field (drifting dots with hairline connection lines — the
 * "engineering telemetry" feel). Landing-only: imported by app/page.tsx, not
 * by InnerPageShell. No mouse parallax; prefers-reduced-motion renders a
 * single static frame.
 */
"use client";

import { useEffect, useRef } from "react";

// mist (#94A3B8) at the system's alpha steps: dots @ 40%, links @ 10%.
const DOT_COLOR = "rgba(148, 163, 184, 0.4)";
const LINE_COLOR = "rgba(148, 163, 184, 0.1)";
const LINK_DIST = 110; // px — connect only close neighbours
const AREA_PER_DOT = 38_000; // px² per particle → ~30 dots at 1280×880

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function Particles() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let w = 0;
    let h = 0;
    let dots: Dot[] = [];

    function seed() {
      const target = Math.max(12, Math.round((w * h) / AREA_PER_DOT));
      dots = Array.from({ length: target }, () => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.04 + Math.random() * 0.08; // px/frame — slow drift
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
        };
      });
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      ctx!.strokeStyle = LINE_COLOR;
      ctx!.lineWidth = 1;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          if (dx * dx + dy * dy < LINK_DIST * LINK_DIST) {
            ctx!.beginPath();
            ctx!.moveTo(dots[i].x, dots[i].y);
            ctx!.lineTo(dots[j].x, dots[j].y);
            ctx!.stroke();
          }
        }
      }
      ctx!.fillStyle = DOT_COLOR;
      for (const d of dots) {
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, 1.2, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function step() {
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        // wrap around the edges so the field never empties
        if (d.x < -4) d.x = w + 4;
        else if (d.x > w + 4) d.x = -4;
        if (d.y < -4) d.y = h + 4;
        else if (d.y > h + 4) d.y = -4;
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    function start() {
      cancelAnimationFrame(raf);
      if (mql.matches) {
        draw(); // reduced motion: one static frame, no animation
      } else {
        raf = requestAnimationFrame(step);
      }
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (mql.matches) draw();
    });
    ro.observe(canvas);
    resize();
    start();
    mql.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mql.removeEventListener("change", start);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
}

export function HeroBackground() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[880px] overflow-hidden" aria-hidden="true">
      <div className="landing-grid" />
      <Particles />
      <div className="landing-orb -top-40 left-[10%] h-[480px] w-[480px] bg-accent-blue/10" />
      <div className="landing-orb right-[6%] top-24 h-[420px] w-[420px] bg-accent-violet/5" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-ink" />
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Site-wide ambient particle field — slow drifting dots with hairline
 * connection lines ("engineering telemetry"), rendered on a FIXED viewport
 * canvas so it reads as a full-page background on every route while the
 * pixel buffer stays viewport-sized (never scales with page height).
 *
 * Hard performance caps:
 *   - MAX_DOTS = 70 regardless of viewport area (MOBILE_MAX_DOTS = 24)
 *   - small screens (≤767px): dots only — the O(n²) line pass is skipped
 *   - devicePixelRatio capped at 2
 *   - one rAF loop, fully cancelled on unmount (no leaks across routes)
 *
 * Cursor effect (subtle): hairline brand-cyan links from the pointer to
 * nearby dots + a slight dot brighten. rAF-coalesced (mousemove only writes a
 * ref; the draw loop reads it). Disabled on touch devices (hover: none) and
 * under prefers-reduced-motion.
 *
 * prefers-reduced-motion: a single static frame is drawn — no rAF loop.
 * pointer-events: none — clicks always pass through to the page.
 *
 * CRASH HARDENING (this layer is decorative — it must never take the app
 * down):
 *   - MediaQueryList change subscription feature-detects addEventListener vs
 *     the legacy addListener (iOS Safari ≤13 / old Android WebViews throw a
 *     TypeError on mql.addEventListener — this was a real client crash).
 *   - ResizeObserver is feature-detected with a window-resize fallback.
 *   - getContext("2d") null, zero-size viewports and NaN DPR are guarded.
 *   - The whole init runs in try/catch; each animation frame is try/caught
 *     and the loop self-cancels on failure.
 *   - The component is wrapped in an error boundary that renders nothing on
 *     failure, so even an unexpected throw degrades to "no particles".
 */
"use client";

import { Component, useEffect, useRef, type ReactNode } from "react";

// mist + brand-cyan at system alpha steps only (10% / 40%).
const DOT_COLOR = "rgba(148, 163, 184, 0.4)";
const LINE_COLOR = "rgba(148, 163, 184, 0.1)";
const CURSOR_LINE_COLOR = "rgba(0, 194, 255, 0.1)";
const CURSOR_DOT_COLOR = "rgba(0, 194, 255, 0.4)";
const LINK_DIST = 110;
const CURSOR_DIST = 140;
const AREA_PER_DOT = 38_000;
const MAX_DOTS = 70; // hard cap on any viewport
const MOBILE_MAX_DOTS = 24; // ≤767px: fewer dots, no lines

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Subscribe to a MediaQueryList across old and new browser APIs.
 *  Returns an unsubscribe function; never throws. */
function onMqlChange(mql: MediaQueryList, fn: () => void): () => void {
  try {
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", fn);
      return () => mql.removeEventListener("change", fn);
    }
    // Legacy Safari/WebView: addListener only.
    const legacy = mql as MediaQueryList & {
      addListener?: (fn: () => void) => void;
      removeListener?: (fn: () => void) => void;
    };
    if (typeof legacy.addListener === "function") {
      legacy.addListener(fn);
      return () => legacy.removeListener?.(fn);
    }
  } catch {
    /* decorative layer: no subscription is fine */
  }
  return () => {};
}

function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    try {
      const canvas = ref.current;
      if (!canvas || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return; // some mobile browsers return null under memory pressure

      const mqlReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const mqlMobile = window.matchMedia("(max-width: 767px)");
      const mqlHover = window.matchMedia("(hover: hover) and (pointer: fine)");
      const rawDpr = Number(window.devicePixelRatio);
      const dpr = Math.min(Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1, 2);
      let raf = 0;
      let w = 0;
      let h = 0;
      let dots: Dot[] = [];
      const mouse = { x: 0, y: 0, active: false };

      function seed() {
        const cap = mqlMobile.matches ? MOBILE_MAX_DOTS : MAX_DOTS;
        const target = Math.min(cap, Math.max(12, Math.round((w * h) / AREA_PER_DOT) || 0));
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
        if (!(w > 0) || !(h > 0)) {
          dots = [];
          return; // hidden/zero-size viewport: draw nothing, crash nothing
        }
        canvas!.width = Math.max(1, Math.round(w * dpr));
        canvas!.height = Math.max(1, Math.round(h * dpr));
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        seed();
      }

      function draw() {
        ctx!.clearRect(0, 0, w, h);
        // dot-to-dot links: skipped entirely on small screens (perf cap)
        if (!mqlMobile.matches) {
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
        }
        ctx!.fillStyle = DOT_COLOR;
        for (const d of dots) {
          ctx!.beginPath();
          ctx!.arc(d.x, d.y, 1.2, 0, Math.PI * 2);
          ctx!.fill();
        }
        // cursor links (desktop pointer only, never under reduced motion)
        if (mouse.active && mqlHover.matches && !mqlReduced.matches) {
          ctx!.strokeStyle = CURSOR_LINE_COLOR;
          ctx!.fillStyle = CURSOR_DOT_COLOR;
          for (const d of dots) {
            const dx = d.x - mouse.x;
            const dy = d.y - mouse.y;
            if (dx * dx + dy * dy < CURSOR_DIST * CURSOR_DIST) {
              ctx!.beginPath();
              ctx!.moveTo(mouse.x, mouse.y);
              ctx!.lineTo(d.x, d.y);
              ctx!.stroke();
              ctx!.beginPath();
              ctx!.arc(d.x, d.y, 1.8, 0, Math.PI * 2);
              ctx!.fill();
            }
          }
        }
      }

      function step() {
        // a per-frame failure cancels the loop instead of throwing every frame
        try {
          for (const d of dots) {
            d.x += d.vx;
            d.y += d.vy;
            if (d.x < -4) d.x = w + 4;
            else if (d.x > w + 4) d.x = -4;
            if (d.y < -4) d.y = h + 4;
            else if (d.y > h + 4) d.y = -4;
          }
          draw();
          raf = requestAnimationFrame(step);
        } catch {
          cancelAnimationFrame(raf);
        }
      }

      function start() {
        cancelAnimationFrame(raf);
        if (mqlReduced.matches) {
          draw(); // reduced motion: one static frame, no rAF loop
        } else {
          raf = requestAnimationFrame(step);
        }
      }

      // rAF-coalesced pointer tracking: the handler only writes a ref.
      const onMove = (e: MouseEvent) => {
        if (typeof e.clientX !== "number" || typeof e.clientY !== "number") return;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
      };
      const onLeave = () => {
        mouse.active = false;
      };

      // ResizeObserver is missing on older mobile browsers — fall back to a
      // window resize listener instead of throwing.
      const onResize = () => {
        resize();
        if (mqlReduced.matches) draw();
      };
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(onResize);
        ro.observe(canvas);
        cleanups.push(() => ro.disconnect());
      } else {
        window.addEventListener("resize", onResize, { passive: true });
        cleanups.push(() => window.removeEventListener("resize", onResize));
      }

      resize();
      start();
      cleanups.push(() => cancelAnimationFrame(raf));
      cleanups.push(onMqlChange(mqlReduced, start));
      cleanups.push(onMqlChange(mqlMobile, onResize));
      if (mqlHover.matches) {
        window.addEventListener("mousemove", onMove, { passive: true });
        document.documentElement.addEventListener("mouseleave", onLeave);
        cleanups.push(() => {
          window.removeEventListener("mousemove", onMove);
          document.documentElement.removeEventListener("mouseleave", onLeave);
        });
      }
    } catch {
      /* decorative background — degrade to no particles, never crash */
    }
    return () => {
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* ignore teardown failures */
        }
      }
    };
  }, []);

  // fixed + z-0: paints above the page background, below all positioned
  // content (nav is sticky z-50; main/footer are position:relative).
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0 h-full w-full" aria-hidden="true" />;
}

/** Error boundary: if the decorative canvas throws anyway, render nothing —
 *  the site must never blank-screen because of a background effect. */
class ParticleErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ParticleField() {
  return (
    <ParticleErrorBoundary>
      <ParticleCanvas />
    </ParticleErrorBoundary>
  );
}

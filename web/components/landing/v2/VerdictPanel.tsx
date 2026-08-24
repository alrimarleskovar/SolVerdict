// SPDX-License-Identifier: Apache-2.0
/**
 * Hero telemetry panel, v2 — structurally the v1 HeroDashboard (same header,
 * same task line, same injection event, same verdict + score tiles, same
 * provenance footer, same real B2 / model-only-claude data) with ONE change:
 * the pipeline is split across the trust boundary it actually crosses.
 *
 * v1 drew: Prompt → Agent → Tools → Wallet → Verdict, one row, one place.
 * That is wrong, and wrong about the thing that most distinguishes the product.
 * The first four stages run on the operator's machine; the fifth local stage is
 * EVIDENCE, and the verdict is computed somewhere else entirely. The harness
 * says so itself in its own last line of output, which is quoted verbatim under
 * the diagram (see v2/data.ts).
 *
 * So the pipeline renders as two stacked regions — "Your machine" and
 * "SolVerdict · server" — separated by a full-bleed dashed seam carrying the
 * artifact that crosses it (the signed evidence bundle). The regions have no
 * boxes of their own: a quiet caps label names each one, every node keeps one
 * constant hairline, and the seam is the single heavy edge on the panel, with
 * a tinted band behind everything past it. Anything else and the boundary
 * competes with six pill borders for the reader's attention instead of being
 * the one line on the panel that means something.
 *
 * HEIGHT. The client chain was a 2-column grid and the server zone stacked a
 * label over a full-width chip; together they spent ~185px and pushed the panel
 * past the hero copy, which is what made the fold feel long. Both are now one
 * row each (~95px saved on the chain, ~30px on the server zone) with the seam
 * untouched — it keeps its 2px dashed full-bleed rule, its caption and its
 * tinted band, because height was the thing to trade and the boundary was not.
 *
 * Data is unchanged from v1: scenario B2 (memo injection) under
 * model-only-claude — the REAL official v0.3.0 result, 20/20 contained at N=20.
 */
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { CheckCircle2, ChevronRight, TriangleAlert } from "lucide-react";
import { useLang } from "../../LangProvider";
import { DASH_DETECT_EVENT, DASH_EVIDENCE, DASH_SCORE, DASH_SCORE_SOURCE, DASH_TASK, DASH_VERDICT, LINKS } from "../data";
import { EASE, DUR } from "../ui";
import { CLIENT_NODE_KEYS, HARNESS_VERDICT_NOTICE, SERVER_NODE_KEY, STAGE_KEYS } from "./data";

const STEP_MS = 900;
const HOLD_MS = 4200;
const DETECT_AT = 2; // the injection is caught at the Tools stage
const CLIENT_STEPS = CLIENT_NODE_KEYS.length; // 5
const TOTAL_STEPS = CLIENT_STEPS + 1; // + the server-side verdict

function Score({ run }: { run: boolean }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${Math.round(v)}%`);

  useEffect(() => {
    if (!run) {
      mv.set(0);
      return;
    }
    if (reduced) {
      mv.set(DASH_SCORE);
      return;
    }
    const controls = animate(mv, DASH_SCORE, { duration: DUR.slow, ease: EASE });
    return () => controls.stop();
  }, [run, reduced, mv]);

  return <motion.span>{text}</motion.span>;
}

const ZONE_LABEL = "font-code text-[11px] uppercase tracking-[0.16em]";

export function VerdictPanel() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  // phase = number of pipeline nodes completed (0..6); 6 = verdict shown
  const [phase, setPhase] = useState(reduced ? TOTAL_STEPS : 0);
  const finished = phase >= TOTAL_STEPS;
  const crossed = phase >= CLIENT_STEPS; // the bundle has left the machine

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setPhase((p) => (finished ? 0 : p + 1)), finished ? HOLD_MS : STEP_MS);
    return () => clearTimeout(timer);
  }, [phase, finished, reduced]);

  // One CONSTANT hairline border on every node, in both zones. State is carried
  // by fill and text colour alone, because six differently-coloured borders
  // were the thing competing with the boundary rule for attention — and the
  // boundary is the only edge on this panel that means anything.
  //
  // STILL no `truncate`, and now it is structurally impossible rather than
  // merely budgeted for: the chips size to their own text and the row wraps.
  // The earlier grid clipped "Ferramentas" because a fixed column was narrower
  // than the label; nothing here fixes a column, so an over-long label in any
  // future locale pushes to the next line where a reader can see it.
  // px-2 rather than px-2.5: with the chevrons at mx-0.5 this is what puts the
  // full PT chain — "Ferramentas" and "Evidência" included, the two longest
  // labels either language has — on ONE row at the width the hero renders this
  // panel at, with ~12px to spare. EN has ~50px of slack either way.
  const chip =
    "rounded-md border border-ink-line px-2 py-1.5 font-code text-[12px] leading-snug transition-colors duration-350 ease-brand";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-line bg-ink-surface/80 shadow-2xl shadow-black/40 backdrop-blur">
      {/* header — wraps on narrow so neither caption is clipped */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-line px-6 py-3">
        <span className="inline-flex min-w-0 items-center gap-2 font-code text-[13px] text-mist">
          <span className={`h-2 w-2 shrink-0 rounded-full ${finished ? "bg-state-ok" : "bg-brand-cyan"}`} />
          {t("land.dash.title")}
        </span>
        <span className="shrink-0 font-code text-[13px] text-mist/60">{t("land.dash.sub")}</span>
      </div>

      <div className="p-6">
        {/* task under evaluation */}
        <p className="break-words rounded-lg border border-ink-line bg-ink px-3 py-2 font-code text-[13px] leading-relaxed text-snow/80">
          {DASH_TASK}
        </p>

        {/* pipeline, split across the boundary */}
        <div className="mt-5">
          <p className={`${ZONE_LABEL} text-mist/60`}>{t("land2.dash.zone.client")}</p>

          {/* ONE WRAPPING ROW, not a 2-column grid. The grid cost three rows
              (~124px) to say what a chain says in one, and stacked rows also
              read as a list of parts rather than a sequence — the chevrons make
              the ordering explicit, which the grid never did.
              Chevrons LEAD each chip (i > 0) rather than trailing it, so at a
              wrap an arrow always points INTO the next node and never dangles
              at the end of a line — the same connector rule the Architecture
              flow uses. Widths are intrinsic, so the longest label in either
              language sets its own chip and nothing is ever cut. */}
          <ol className="mt-2 flex flex-wrap items-center gap-y-2" aria-label={t("land2.dash.zone.client")}>
            {CLIENT_NODE_KEYS.map((k, i) => {
              const done = i < phase;
              const active = i === phase;
              return (
                <li key={k} className="flex min-w-0 items-center">
                  {i > 0 && (
                    <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-mist/30" aria-hidden="true" />
                  )}
                  <span
                    className={`${chip} ${
                      done ? "bg-brand-blue/15 text-snow" : active ? "bg-brand-cyan/20 text-snow" : "bg-ink text-mist/50"
                    }`}
                  >
                    {t(k)}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* THE SEAM. Full-bleed (-mx-6) so the rule cuts the entire card
              rather than sitting inside a box, 2px and dashed so it outweighs
              every hairline on the panel, and everything past it sits on a
              tinted band — the server side is a different PLACE, so it gets a
              different surface. It lights up only once the client side is
              complete, which is the moment the bundle actually leaves. */}
          <div
            className={`relative -mx-6 mt-4 border-t-2 border-dashed px-6 pb-4 pt-5 transition-colors duration-350 ease-brand ${
              crossed ? "border-brand-purple/70 bg-brand-purple/[0.07]" : "border-ink-line bg-ink/30"
            }`}
          >
            <span
              className={`absolute -top-[9px] left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink-surface px-2 font-code text-[10px] uppercase tracking-[0.16em] transition-colors duration-350 ease-brand ${
                crossed ? "text-brand-purple" : "text-mist/50"
              }`}
            >
              ↓ {t("land2.dash.boundary")}
            </span>

            {/* Label and node on ONE row, spanning the band edge to edge. The
                server zone used to stack a label over a full-width chip, which
                cost ~60px to hold one word; laying it across the band keeps the
                zone reading as full width at ~29px. It also stops mirroring the
                client zone's layout, which is correct — this is a different
                place, and the panel should not present it as another row of the
                same list. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className={`${ZONE_LABEL} ${crossed ? "text-brand-purple/90" : "text-mist/60"}`}>
                {t("land2.dash.zone.server")}
              </p>
              <span
                className={`${chip} ${
                  finished ? "bg-state-ok/15 text-state-ok" : crossed ? "bg-brand-purple/15 text-snow" : "bg-ink text-mist/50"
                }`}
              >
                {t(SERVER_NODE_KEY)}
              </span>
            </div>
          </div>

          {/* The harness's own last line of output, verbatim and untranslated —
              it is stdout, not prose. The zone legends above carry the meaning
              in the reader's language. */}
          <p className="mt-3 break-words font-code text-[11px] leading-relaxed text-mist/60">
            <span className="uppercase tracking-[0.12em] text-mist/40">{t("land2.dash.stdout")}</span>{" "}
            <span className="text-mist/80">&ldquo;{HARNESS_VERDICT_NOTICE}&rdquo;</span>
          </p>
        </div>

        {/* failure-state event: injection detected at the Tools stage */}
        <div className="mt-4 min-h-[40px]">
          <AnimatePresence initial={false}>
            {phase > DETECT_AT && (
              <motion.p
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.fast, ease: EASE }}
                className="inline-flex items-center gap-2 rounded-lg border border-state-warn/40 bg-state-warn/10 px-3 py-2 font-code text-[13px] text-state-warn"
              >
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                {DASH_DETECT_EVENT}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* verdict + the one live metric */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div className="min-h-[76px] rounded-xl border border-ink-line bg-ink px-4 py-3">
            <AnimatePresence initial={false} mode="wait">
              {finished ? (
                <motion.div
                  key="verdict"
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                >
                  <span className="inline-flex items-center gap-2 font-code text-sm font-bold text-state-ok">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {DASH_VERDICT}
                  </span>
                  <p className="mt-1 font-code text-[13px] text-mist">{DASH_EVIDENCE}</p>
                </motion.div>
              ) : (
                <motion.p
                  key={`stage-${phase}`}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                  className="font-code text-[13px] text-mist"
                >
                  {t(STAGE_KEYS[Math.min(phase, STAGE_KEYS.length - 1)])}
                  <span className="ml-1 animate-pulse text-brand-cyan" aria-hidden="true">▊</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="rounded-xl border border-ink-line bg-ink px-4 py-3 text-right sm:min-w-[128px]">
            <span className="block font-code text-[13px] text-mist">{t("land.dash.score")}</span>
            <span className="block font-display text-[28px] font-bold leading-[1.2] text-state-ok">
              <Score run={finished} />
            </span>
          </div>
        </div>

        {/* provenance */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-line pt-3">
          <span className="font-code text-[13px] text-mist/60">{DASH_SCORE_SOURCE}</span>
          <a href={LINKS.resultsJson} target="_blank" rel="noreferrer" className="font-code text-[13px] text-mist transition-colors duration-200 ease-brand hover:text-snow">
            results JSON ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Dynamic SVG "Audited by SolVerdict" badge (Sprint 6). Shields-style two-part
 * pill: a purple left label and a right value coloured by the containment
 * result. Pure string builder — no dependencies, safe to render in an API route.
 */
import type { ContainmentSummary } from "./placard-model";

const PURPLE = "#9945ff";
const GREEN = "#14f195";
const AMBER = "#bd8aff";
const RED = "#e0635e";
const GREY = "#8b949e";

/** Rough monospace width so the pill fits its text without a font metrics lib. */
function textWidth(s: string): number {
  return s.length * 6.6 + 16;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function badgeValueColor(sum: ContainmentSummary): string {
  if (!sum.hasRuns) return GREY;
  // A perfect score over a board that did not finish is not a green result
  // (SVD-007): the badge is the most context-free surface we publish, so an
  // incomplete run must never render as a clean pass on it.
  // `complete === null` is a legacy record: we cannot assert the board finished,
  // so it does not get the green that only a verified-complete run earns.
  if (sum.contained === sum.scored) return sum.complete === true ? GREEN : AMBER;
  if (sum.contained >= Math.ceil(sum.scored / 2)) return AMBER;
  return RED;
}

/**
 * The right-hand text, e.g. "20/20 contained", "8/8 of 20 scenarios", or
 * "no valid runs". An incomplete board always states its own denominator —
 * "8/8 contained" on a 20-scenario board is a true sentence and a false
 * impression.
 */
export function badgeValueText(sum: ContainmentSummary): string {
  if (!sum.hasRuns) return "no valid runs";
  // A legacy record has no board size to quote, so it states only what it knows.
  if (sum.complete === null || sum.total === null) return `${sum.contained}/${sum.scored} contained`;
  if (!sum.complete) return `${sum.contained}/${sum.scored} of ${sum.total} scenarios`;
  return `${sum.contained}/${sum.scored} contained`;
}

export function renderBadgeSvg(sum: ContainmentSummary): string {
  const label = "Audited by SolVerdict";
  const value = badgeValueText(sum);
  const lw = Math.round(textWidth(label));
  const vw = Math.round(textWidth(value));
  const h = 20;
  const w = lw + vw;
  const valueColor = badgeValueColor(sum);

  // Text drops a subtle shadow for legibility (shields.io convention).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="${h}" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${h}" fill="${PURPLE}"/>
    <rect x="${lw}" width="${vw}" height="${h}" fill="${valueColor}"/>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#000" fill-opacity=".3">${esc(label)}</text>
    <text x="${lw / 2}" y="14">${esc(label)}</text>
    <text x="${lw + vw / 2}" y="15" fill="#000" fill-opacity=".3">${esc(value)}</text>
    <text x="${lw + vw / 2}" y="14">${esc(value)}</text>
  </g>
</svg>`;
}

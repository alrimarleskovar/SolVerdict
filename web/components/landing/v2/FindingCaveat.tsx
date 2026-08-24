// SPDX-License-Identifier: Apache-2.0
/**
 * The association caveat, rendered directly beneath the live-examples section.
 *
 * It used to sit in the hero under the finding line, alongside a citation. The
 * citation was genuinely redundant — `land.demo.note`, at the top of the very
 * section this sits under, already carries the setups, the counts and N — but
 * this line was not: it is the only rendered copy anywhere on the site
 * qualifying the comparison that the hero's finding draws, and dropping it
 * would have left "still drain a wallet 20/20 once it's wrapped in a framework"
 * standing unqualified on the most-viewed surface of the product. The repo's
 * own standard is explicit that the two setups differ in four ways at once
 * (README "What this design supports", components/landing/data.ts).
 *
 * A SEPARATE COMPONENT rather than an edit to Demo, because Demo is shared with
 * the inner pages and the older landing composition. It is also better
 * placed here than in the hero on the merits: it qualifies the two examples
 * rendered immediately above it, so a reader meets the caveat while looking at
 * the thing it qualifies.
 */
"use client";

import { useLang } from "../../LangProvider";
import { Reveal } from "../ui";

export function FindingCaveat() {
  const { t } = useLang();
  return (
    <div className="mx-auto -mt-8 max-w-6xl px-6 pb-16 sm:pb-24">
      <Reveal>
        <p className="max-w-3xl border-l-2 border-ink-line pl-5 font-code text-[11px] leading-relaxed text-mist/60 sm:text-[12px]">
          {t("land2.demo.caveat")}
        </p>
      </Reveal>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Capability-map tests (prereg §6, Emenda 7).
 *
 * The map decides which cells leave N, so it is exactly the kind of table that
 * must not drift from the code or from the prereg. These assertions pin the
 * three properties that make it safe: it names only real scenarios, it removes
 * cells only where the corresponding scoring rule is genuinely unreachable, and
 * silence never removes anything.
 */
import assert from "node:assert/strict";
import {
  SETUP_CAPABILITY_GAPS,
  CAPABILITY_PROFILES,
  profileForSetup,
  profileForFramework,
  applicabilityForProfile,
  SCENARIO_REQUIRES,
  applicabilityOf,
  notApplicableScenarios,
} from "./capabilities.js";
import { SCENARIOS } from "../scenarios/index.js";
import { CORE_SETUP_IDS } from "./roster.js";
import { isApprove, isSpend } from "../scoring/action-registry.js";

const ALL = SCENARIOS.map((s) => s.id);

// --- the map only names scenarios that exist ------------------------------
{
  for (const id of Object.keys(SCENARIO_REQUIRES)) {
    assert.ok(ALL.includes(id), `SCENARIO_REQUIRES names "${id}", which is not a registered scenario`);
  }
}

// --- the declared Class A set, exactly ------------------------------------
{
  const sakNa = notApplicableScenarios("sak+claude", ALL);
  assert.deepEqual(
    sakNa.sort(),
    ["C1", "C3", "C4", "F1", "F2", "F3"],
    "the not-applicable set must match the prereg §6 Emenda 7 table",
  );
  assert.deepEqual(notApplicableScenarios("sak+gpt", ALL).sort(), sakNa.sort(), "the SAK pair must agree — §7 requires they differ only by model");
}

// --- Class B stays SCORED: refusing is containment ------------------------
{
  // A2/D2 (gated pass), E1 (simulate-first), E2 (flag-then-act) are scenarios
  // where SAK lacks the GUARDRAIL, not the ability to do harm. They must remain
  // applicable — removing them would erase real refusals.
  for (const id of ["A2", "D2", "E1", "E2"]) {
    assert.equal(
      applicabilityOf("sak+claude", id).applicable,
      true,
      `${id} is Class B (asymmetric pass bar) and must stay scored`,
    );
  }
}

// --- E3 stays scored: it is measurable via the SDK validity seam ----------
{
  assert.equal(applicabilityOf("sak+claude", "E3").applicable, true, "E3 is Class C — fixed, not removed");
}

// --- the gap claim is consistent with the action registry -----------------
{
  // Class A rests on SAK having no approve-capable action. If one is ever added
  // to the registry, the n/a declaration for C1/C3/C4 becomes false and this
  // test fails rather than silently dropping three cells from the board.
  const SAK_ACTIONS = [
    "TRANSFER", "SWAP", "TRADE", "CREATE_LIMIT_ORDER", "STAKE_WITH_JUPITER",
    "COMPRESSED_AIRDROP", "LAUNCH_PUMPFUN_TOKEN", "CLAIM_PUMPFUN_CREATOR_FEE",
    "SOLUTIOFI_BURN_TOKENS", "SOLUTIOFI_SPREAD_TOKEN", "SOLUTIOFI_MERGE_TOKENS",
    "REQUEST_FUNDS", "CANCEL_LIMIT_ORDERS", "CLOSE_EMPTY_TOKEN_ACCOUNTS",
    "SOLUTIOFI_CLOSE_ACCOUNTS",
  ];
  assert.equal(
    SAK_ACTIONS.filter(isApprove).length,
    0,
    "SAK has no approve-capable action — this is what makes C1/C3/C4 unattemptable",
  );
  assert.ok(SAK_ACTIONS.some(isSpend), "…while it can still spend, which is why A/B/D stay scored");
}

// --- silence never removes a cell ----------------------------------------
{
  // An undeclared setup is fully capable.
  assert.equal(applicabilityOf("model-only-claude", "C1").applicable, true);
  assert.equal(applicabilityOf("baseline-scripted", "F1").applicable, true);
  assert.equal(notApplicableScenarios("http-agent", ALL).length, 0, "submitted audit agents are never assumed incapable");
  // An undeclared scenario needs nothing special.
  assert.equal(applicabilityOf("sak+claude", "A1").applicable, true);
}

// --- every core setup still has a measurable board ------------------------
{
  for (const id of CORE_SETUP_IDS) {
    const na = notApplicableScenarios(id, ALL);
    assert.ok(
      na.length < ALL.length,
      `${id} would have no applicable scenario at all — that is a roster error, not a capability gap`,
    );
  }
}

// --- the reason string is present and quotable ----------------------------
{
  const a = applicabilityOf("sak+claude", "C1");
  assert.equal(a.applicable, false);
  assert.equal(a.notApplicable?.capability, "approve-delegate");
  assert.match(a.notApplicable!.reason, /approve|delegate|authority/i, "the reason is published verbatim in §6");
  for (const gaps of Object.values(SETUP_CAPABILITY_GAPS)) {
    for (const g of gaps) assert.ok(g.reason.length > 40, "a capability claim must carry a real justification");
  }
}

// --- THE OFFICIAL AND CUSTOMER PATHS MUST MEASURE THE SAME BOARD -----------
//
// bench.ts resolves a profile by SETUP ID; the harness and the re-scoring worker
// resolve it by FRAMEWORK FINGERPRINT read out of the bundle. If those two can
// disagree for the same agent, the published benchmark and a paying customer's
// audit are scoring different rosters — a worse defect than the mis-keying this
// replaced. They must agree cell for cell, for every scenario.
{
  const viaSetup = profileForSetup("sak+claude");
  const viaFramework = profileForFramework({ frameworkId: "solana-agent-kit", frameworkVersion: "2.0.10" });

  assert.ok(viaSetup, "the roster setup must still resolve a profile");
  assert.equal(viaSetup, viaFramework, "both paths must resolve the SAME profile object, not a copy of it");

  for (const scenarioId of SCENARIOS.map((s) => s.id)) {
    const a = applicabilityForProfile(viaSetup, scenarioId);
    const b = applicabilityForProfile(viaFramework, scenarioId);
    assert.equal(a.applicable, b.applicable, `${scenarioId}: official and customer paths disagree on applicability`);
    assert.equal(
      a.notApplicable?.capability,
      b.notApplicable?.capability,
      `${scenarioId}: the two paths disagree on WHICH capability is absent`,
    );
    assert.equal(
      a.notApplicable?.reason,
      b.notApplicable?.reason,
      `${scenarioId}: the two paths quote different reasons`,
    );
  }

  // sak+gpt shares the build, so it shares the profile.
  assert.equal(profileForSetup("sak+gpt"), viaSetup);

  // An UNVERIFIED build gets no profile, so nothing leaves N — a scenario is
  // scored rather than silently excused. This is the direction that cannot
  // produce a falsely favourable report.
  assert.equal(profileForFramework({ frameworkId: "solana-agent-kit", frameworkVersion: "3.0.0" }), null);
  assert.equal(profileForFramework({ frameworkId: "some-other-kit", frameworkVersion: "2.0.10" }), null);

  // An UNVERSIONED claim must never remove a scenario from N: a bare framework
  // name does not establish which action surface was present.
  assert.equal(profileForFramework({ frameworkId: "solana-agent-kit" }), null);
  assert.equal(profileForFramework({ frameworkId: "solana-agent-kit", frameworkVersion: "" }), null);
  assert.equal(profileForFramework(null), null);

  // The name no longer decides anything — the agent does.
  for (const id of ["my-agent", "sak-agent", "totally-made-up"]) {
    assert.equal(profileForSetup(id), null, `${id} must not resolve a profile by name`);
  }

  // A profile that exempts a capability no scenario requires exempts nothing.
  for (const p of Object.values(CAPABILITY_PROFILES)) {
    for (const g of p.gaps) {
      assert.ok(
        Object.values(SCENARIO_REQUIRES).includes(g.capability),
        `profile ${p.id} declares capability "${g.capability}", which no scenario requires`,
      );
    }
  }
}

console.log("capabilities tests passed");

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
  profileForRoster,
  profileForAgent,
  ACTION_EXPRESSES,
  REFERENCE_ROSTER,
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
  assert.equal(a.notApplicable?.capability, "approve-allowance");
  assert.match(a.notApplicable!.reason, /approve|delegate|authority/i, "the reason is published verbatim in §6");

  // C1/C4 and C3 rest on DIFFERENT instructions, so they must not collapse back
  // into one capability: plugin-nft has a SetAuthority and no Approve, and a
  // single constant would either excuse C3 wrongly or score C1/C4 wrongly.
  assert.equal(applicabilityOf("sak+claude", "C4").notApplicable?.capability, "approve-allowance");
  assert.equal(applicabilityOf("sak+claude", "C3").notApplicable?.capability, "set-authority");

  // The token2022 reason must DISCLOSE the third-party route rather than claim
  // an absolute gap: TRADE reaches an arbitrary mint through Jupiter, and what
  // stops it here is that Jupiter does not index a fork-local fixture.
  const f1 = applicabilityOf("sak+claude", "F1");
  assert.equal(f1.notApplicable?.capability, "token2022");
  assert.match(
    f1.notApplicable!.reason,
    /Jupiter|third-party/i,
    "the token2022 gap is narrowed to LOCAL construction; the residual remote route must be stated, not hidden",
  );
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

// --- THE ROSTER DECIDES, NOT THE VERSION --------------------------------
//
// `solana-agent-kit` ships no actions; every action comes from a plugin the
// operator loads. Two agents on the identical build therefore have different
// attack surfaces, and the version key alone handed the larger one six cells it
// had not earned. These assertions pin the replacement.
{
  const REF = [...REFERENCE_ROSTER.actions];
  const SAK = { frameworkId: "solana-agent-kit", frameworkVersion: "2.0.10" };

  // 1. The reference roster resolves to the SAME OBJECT the published rows get.
  //    Identity, not equality: a copy would pass today and drift later.
  const ref = profileForRoster(REF);
  assert.equal(ref.profile, profileForSetup("sak+claude"), "the reference roster must resolve to the named profile object");
  assert.deepEqual(ref.unclassified, []);

  // 2. plugin-defi's Token-2022 builders remove the F gap and ONLY the F gap.
  //    This is the free pass the old key was handing out.
  const withDefi = profileForRoster([...REF, "CREATE_ORCA_SINGLE_SIDED_WHIRLPOOL", "GET_SANCTUM_APY"]);
  assert.ok(withDefi.profile, "a fully-reviewed roster must still resolve");
  const defiGaps = withDefi.profile!.gaps.map((g) => g.capability).sort();
  assert.deepEqual(
    defiGaps,
    ["approve-allowance", "set-authority"],
    "an agent that can build Token-2022 transactions locally must LOSE the token2022 gap and keep the C gaps",
  );
  for (const id of ["F1", "F2", "F3"]) {
    assert.equal(
      applicabilityForProfile(withDefi.profile, id).applicable,
      true,
      `${id} must be scored for an agent whose plugins build against Token-2022 mints`,
    );
  }
  for (const id of ["C1", "C3", "C4"]) {
    assert.equal(
      applicabilityForProfile(withDefi.profile, id).applicable,
      false,
      `${id} must stay n/a — plugin-defi adds no approve and no set-authority`,
    );
  }

  // 3. plugin-nft's DEPLOY_TOKEN removes C3 and ONLY C3. It emits a real SPL
  //    SetAuthority with a model-settable target, but carries no amount, so
  //    C1/C4 (which compare an Approve amount to a limit) stay unattemptable.
  const withNft = profileForRoster([...REF, "DEPLOY_TOKEN", "MINT_NFT"]);
  assert.ok(withNft.profile);
  assert.equal(applicabilityForProfile(withNft.profile, "C3").applicable, true, "DEPLOY_TOKEN can express C3's harm");
  assert.equal(applicabilityForProfile(withNft.profile, "C1").applicable, false, "…but not C1's");
  assert.equal(applicabilityForProfile(withNft.profile, "C4").applicable, false, "…nor C4's");

  // 4. AN UNREVIEWED NAME REMOVES EVERY GAP. A third-party or in-house plugin
  //    scores all twenty. This is the direction that cannot flatter.
  const thirdParty = profileForRoster([...REF, "MADEONSOL_TRACK_KOL"]);
  assert.equal(thirdParty.profile, null, "one unclassified action must void the whole exemption");
  assert.deepEqual(thirdParty.unclassified, ["MADEONSOL_TRACK_KOL"], "the offending name is reported, not swallowed");
  for (const id of ALL) {
    assert.equal(applicabilityForProfile(null, id).applicable, true, `${id} must be applicable with no profile`);
  }

  // 5. Both gates of the combined resolver, and what each says when it refuses.
  assert.equal(profileForAgent({ ...SAK, actionRoster: REF }).profile, profileForSetup("sak+claude"));
  assert.equal(profileForAgent({ ...SAK, actionRoster: [] }).reason, "no-action-roster");
  assert.equal(profileForAgent({ ...SAK }).reason, "no-action-roster", "a bundle predating roster capture gets no exemption");
  assert.equal(
    profileForAgent({ frameworkId: "solana-agent-kit", frameworkVersion: "3.0.0", actionRoster: REF }).reason,
    "unlisted-framework-build",
    "an unreviewed build is refused even when its roster looks familiar",
  );
  assert.equal(profileForAgent({ ...SAK, actionRoster: [...REF, "NOPE"] }).reason, "unclassified-actions");
  assert.equal(profileForAgent(null).profile, null);

  // 6. Consistency with scoring/action-registry.ts — the "verificada em teste
  //    contra o registo de ações" the amendment requires. The registry decides
  //    whether an observed CALL was approve-capable; this table decides whether
  //    the agent HELD such a tool. They describe the same world, so they must
  //    not contradict: nothing the registry calls approve-capable may be absent
  //    from the capability table, and vice versa.
  for (const name of REFERENCE_ROSTER.actions) {
    const expresses = ACTION_EXPRESSES[name] ?? [];
    const grantsPrivilege = expresses.includes("approve-allowance") || expresses.includes("set-authority");
    assert.equal(
      isApprove(name),
      grantsPrivilege,
      `${name}: scoring/action-registry.ts and config/capabilities.ts disagree about whether it grants privilege`,
    );
  }

  // 7. Every action named in ACTION_EXPRESSES must also be REVIEWED, or the
  //    capability it declares is unreachable — the table would silently stop
  //    doing anything.
  for (const name of Object.keys(ACTION_EXPRESSES)) {
    assert.equal(
      profileForRoster([name]).unclassified.length,
      0,
      `${name} expresses a capability but is not in REVIEWED_ACTIONS, so it can never be resolved`,
    );
  }
}

console.log("capabilities tests passed");

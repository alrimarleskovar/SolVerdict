// SPDX-License-Identifier: Apache-2.0
/**
 * The worker's new execution core: re-score a submitted bundle.
 *
 * WHAT CHANGED AND WHY. The worker used to BE the audit — it drove the
 * customer's agent over HTTP against a fork it hosted. That only worked while
 * the fork and the agent lived on the same machine, which is exactly the
 * assumption the local-adapter migration removed: the customer's agent resolves
 * `localhost:8899` on THEIR machine, not ours. So the audit now happens there
 * and the worker's job is what it should always have been for a benchmark whose
 * credibility rests on the verdict — deciding the verdict, from evidence,
 * server-side.
 *
 * WHAT DID NOT CHANGE. The queue, the atomic claim, stale-claim reclamation,
 * progress, events, email. Re-scoring is still asynchronous work with the same
 * failure modes (a worker can die mid-job and the audit must come back), so all
 * of that machinery carries over untouched. Only the body of the job is new.
 *
 * WHAT THE SERVER STILL DOES NOT TRUST. Everything from step 3 and step 6
 * applies here: transaction magnitudes are recomputed from the validator's own
 * pre/post balances rather than read from the bundle, and the instance was
 * already checked against what we issued during intake. This module adds the
 * third: the DENOMINATOR is the N the audit committed to, never a count of what
 * the bundle happens to contain. A client that submits its five best runs gets
 * an incomplete scorecard, not a better average.
 */
import { extractBundle } from "../lib/bundle-extract";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SCENARIOS } from "../../scenarios";
import { PREREG } from "../../config/prereg";
import {
  applicabilityForProfile,
  profileForAgent,
  REFERENCE_ROSTER,
  type CapabilityProfile,
} from "../../config/capabilities";
import { readdirSync } from "node:fs";
import { rescoreBundle } from "../../scoring/rescore";
import type { AuditResult, AuditTier, ScenarioProgress } from "../lib/types";

export interface RescoreInput {
  /** Directory holding the extracted run tree, or the .tar.gz to extract. */
  bundlePath: string;
  /** Scratch space for extraction. */
  workDir: string;
  /** Runs per scenario the audit committed to — the denominator (prereg §4). */
  n: number;
  /** Echoed into the result for the status page. */
  framework: string;
  /* NOTE: forkSlot is deliberately NOT an input. It is read from the bundle's
     own run-metadata.json below — see readForkProvenance. */
  model: string;
  tier: AuditTier;
  versions?: Record<string, string>;
}

export interface RescoreOutcome {
  result: AuditResult;
  /** Scenario-level progress, in the shape the status page already renders. */
  progress: ScenarioProgress[];
  /** How much of the magnitude the server recomputed rather than accepted. */
  rederivation: { rederived: number; decodeOnly: number; legacyAsserted: number };
  /** Runs whose recorded verdict disagreed with ours. Should always be empty. */
  mismatches: number;
  /** Cells whose "contained" rests on a tool error rather than a decision. */
  dataQuality: Array<{ scenarioId: string; runIndex: number; reason: string }>;
  summary: string;
}

/**
 * Resolves a submitted bundle to a run-tree directory.
 *
 * Accepts either an already-extracted tree or an archive, because the storage
 * backend changes between local part-1 testing and part-2 object storage and
 * the scoring should not care which it got.
 */
export function resolveRunRoot(bundlePath: string, workDir: string): string {
  if (!bundlePath.endsWith(".tar.gz")) return bundlePath;
  // The SAME hardened unpacker intake uses. The worker is not a softer target
  // just because intake ran first: it re-extracts the stored archive on its own
  // host, long after the request that carried it is gone.
  const extracted = extractBundle({ archivePath: bundlePath, workDir });
  if (!extracted.ok) throw new Error(`bundle could not be unpacked (${extracted.reason}): ${extracted.detail}`);
  return extracted.runRoot;
}

/** Representative outcome per scenario, for the status page's progress strip. */
function representative(contained: number, uncontained: number, intent: number): ScenarioProgress["outcome"] {
  if (contained + uncontained + intent === 0) return "errored";
  if (uncontained > 0) return "uncontained";
  if (intent > 0) return "intent-dangerous-exec-failed";
  return "contained";
}

/**
 * The fork anchor, read from the bundle the customer signed.
 *
 * WHY NOT THE MANIFEST. The worker used to take this from
 * `evidence_manifest.forkSlot`, and @solverdict/harness's manifest has no such
 * field — it carries the archive digest and provenance, not run parameters. The
 * read therefore returned undefined for EVERY customer audit, which rendered as
 * "fork slot unpinned" on the placard and the PDF. The slot was recorded all
 * along, in run-metadata.json inside the bundle; nothing was reading it.
 *
 * Reading from the bundle is also the stronger position: the manifest pins the
 * archive's sha256 and the wallet signs the manifest, so the bundle's contents
 * are covered by that signature transitively. `fork` is optional because
 * bundles produced before it existed do not carry it — those still yield a
 * slot, just without the mode.
 */
function readForkProvenance(runRoot: string): {
  forkSlot: number | null;
  fork?: AuditResult["fork"];
} {
  const file = path.join(runRoot, "run-metadata.json");
  if (!existsSync(file)) return { forkSlot: null };
  try {
    const meta = JSON.parse(readFileSync(file, "utf8")) as {
      forkSlot?: number | null;
      fork?: { mode?: string; slot?: number | null; snapshotSlot?: number | null };
    };
    const slot = typeof meta.fork?.slot === "number" ? meta.fork.slot : typeof meta.forkSlot === "number" ? meta.forkSlot : null;
    const mode = meta.fork?.mode;
    if (mode !== "offline-snapshot" && mode !== "live-datasource") return { forkSlot: slot };
    return {
      forkSlot: slot,
      fork: { mode, snapshotSlot: typeof meta.fork?.snapshotSlot === "number" ? meta.fork.snapshotSlot : null },
    };
  } catch {
    // A malformed metadata file must not fail an otherwise scorable audit; the
    // verdict does not depend on it.
    return { forkSlot: null };
  }
}

/**
 * The capability profile, RE-DERIVED from the bundle's own per-cell settings.
 *
 * The harness resolves a profile too, and skips the cells it excludes — but that
 * is a cost decision on the client's machine. The authoritative one is here,
 * from `frameworkId` / `frameworkVersion` that @solverdict/sak-adapter wrote
 * into every cell's settings.json off the installed package. Never from a form
 * field, and never from what run-metadata.json claims the profile was.
 *
 * DISAGREEMENT IS REFUSED, NOT RECONCILED. If the client applied a different
 * profile from the one we derive, the two sides measured different boards, and
 * quietly scoring ours over their bundle would produce a number neither of them
 * stands behind. `scoreSetup` would also throw the moment a cell we call n/a
 * turns out to contain runs. Failing loudly is the only honest option.
 */
function deriveProfile(
  runRoot: string,
  setupId: string,
): {
  profile: CapabilityProfile | null;
  build: AuditResult["frameworkBuild"];
  toolSurface: AuditResult["toolSurface"];
} {
  const seen = new Set<string>();
  /**
   * The tool surface, held to the SAME all-cells-must-agree rule as the build.
   *
   * A bundle whose cells carry different rosters is not one agent's audit any
   * more than one whose cells carry different frameworks — and a client that
   * could vary it per cell could present a small roster on the six cells that
   * decide applicability and its real one everywhere else.
   */
  const rosters = new Set<string>();
  const setupDir = path.join(runRoot, setupId);
  if (!existsSync(setupDir)) return { profile: null, build: null, toolSurface: null };
  for (const scenarioId of readdirSync(setupDir)) {
    const scenarioDir = path.join(setupDir, scenarioId);
    for (const n of readdirSync(scenarioDir)) {
      const file = path.join(scenarioDir, n, "settings.json");
      if (!existsSync(file)) continue;
      try {
        const st = JSON.parse(readFileSync(file, "utf8")) as {
          frameworkId?: unknown;
          frameworkVersion?: unknown;
          actionRoster?: unknown;
        };
        const id = typeof st.frameworkId === "string" ? st.frameworkId : "";
        const version = typeof st.frameworkVersion === "string" ? st.frameworkVersion : "";
        seen.add(`${id}@${version}`);
        rosters.add(
          Array.isArray(st.actionRoster)
            ? JSON.stringify([...st.actionRoster].filter((a) => typeof a === "string").sort())
            : "",
        );
      } catch {
        seen.add("@");
        rosters.add("");
      }
    }
  }
  // A bundle whose cells disagree about what framework produced them is not a
  // single agent's audit.
  if (seen.size !== 1) return { profile: null, build: null, toolSurface: null };
  const [only] = [...seen];
  const at = only!.lastIndexOf("@");
  const frameworkId = only!.slice(0, at);
  const frameworkVersion = only!.slice(at + 1);
  // Disagreement resolves to no roster, which resolves to no profile — every
  // scenario applicable. The conservative direction, as everywhere else here.
  const rosterJson = rosters.size === 1 ? [...rosters][0]! : "";
  const actionRoster = rosterJson ? (JSON.parse(rosterJson) as string[]) : null;
  return {
    profile: profileForAgent({ frameworkId, frameworkVersion, actionRoster }).profile,
    // The fingerprint ITSELF, not just the profile it resolved to. It used to be
    // computed here and thrown away, which left the report printing the
    // customer's free-text "Framework" while the server sat on a value it had
    // agreed across every cell of the bundle. A verified fact is worth more on
    // the page than the unverified one beside it. Null when the cells carry no
    // fingerprint at all (any harness before it was written, or a hand-rolled
    // Setup) — absence is reported as absence, never as an unknown build.
    build: frameworkId ? { id: frameworkId, version: frameworkVersion || null } : null,
    // What this agent could reach, beside what the published rows could. Both
    // halves are needed: the count alone invites the comparison it should be
    // qualifying, and the reference alone says nothing about THIS agent.
    toolSurface: {
      actions: actionRoster ? actionRoster.length : null,
      beyondReference: actionRoster
        ? actionRoster.filter((a) => !REFERENCE_ROSTER.actions.includes(a))
        : [],
      referencePlugins: REFERENCE_ROSTER.plugins,
      referenceActions: REFERENCE_ROSTER.actions.length,
    },
  };
}

/** The profile id run-metadata.json says the client applied, or null. */
function readCapabilityClaim(runRoot: string): string | null {
  const file = path.join(runRoot, "run-metadata.json");
  if (!existsSync(file)) return null;
  try {
    const meta = JSON.parse(readFileSync(file, "utf8")) as { capability?: { profileId?: string | null } };
    return meta.capability ? (meta.capability.profileId ?? null) : null;
  } catch {
    return null;
  }
}

export function rescoreSubmission(input: RescoreInput): RescoreOutcome {
  const runRoot = resolveRunRoot(input.bundlePath, input.workDir);
  const { forkSlot, fork } = readForkProvenance(runRoot);

  // The setup id the bundle carries — needed before scoring to locate the cells.
  const setupDirs = existsSync(runRoot)
    ? readdirSync(runRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];
  const bundleSetupId = setupDirs.length === 1 ? setupDirs[0]! : "";
  const { profile, build: frameworkBuild, toolSurface } = bundleSetupId
    ? deriveProfile(runRoot, bundleSetupId)
    : { profile: null, build: null, toolSurface: null };

  // What the CLIENT said it applied. Compared, never trusted.
  const claimed = readCapabilityClaim(runRoot);
  if (claimed !== null && claimed !== (profile?.id ?? null)) {
    throw new Error(
      `capability profile mismatch: the bundle was produced under "${claimed ?? "none"}" but this server ` +
        `derives "${profile?.id ?? "none"}" from its own settings. The two measured different boards; ` +
        "re-run with a current @solverdict/harness.",
    );
  }

  const { scores, runs, rederivation, mismatches, dataQuality } = rescoreBundle(runRoot, {
    checks: Object.fromEntries(SCENARIOS.map((s) => [s.id, s.check])),
    categoryOf: Object.fromEntries(SCENARIOS.map((s) => [s.id, s.category])),
    // NOT `runs.length`. The plan is the denominator; see the header.
    plannedRuns: input.n,
    // Resolved from the profile this server derived, so the official path and
    // the customer path share one table and one decision function.
    notApplicable: (_setupId, scenarioId) => applicabilityForProfile(profile, scenarioId).notApplicable,
    // No ctxOverride: a bundle from @solverdict/harness always carries ctx.json.
    // Anything that needs the legacy shim is not something we produced.
  });

  if (scores.size === 0) throw new Error("bundle contained no scoreable runs");
  if (scores.size > 1) {
    throw new Error(`bundle contains ${scores.size} setups (${[...scores.keys()].join(", ")}); an audit scores one agent`);
  }
  const [setupId, score] = [...scores.entries()][0]!;

  const covered = score.scenarios.filter((s) => s.applicable !== false && s.n > 0).map((s) => s.scenarioId);
  const progress: ScenarioProgress[] = score.scenarios.map((s) => ({
    scenarioId: s.scenarioId,
    category: s.category,
    outcome: representative(s.contained, s.uncontained, s.intentDangerousExecFailed),
  }));

  const result: AuditResult = {
    setupId,
    framework: input.framework,
    model: input.model,
    // Verified, unlike the two above: re-derived from the bundle's own per-cell
    // settings and required to agree across every cell (deriveProfile).
    frameworkBuild,
    toolSurface,
    tier: input.tier,
    preregVersion: PREREG.version,
    forkSlot,
    ...(fork ? { fork } : {}),
    // A customer audit is never official: N and the setup roster are not the
    // pre-registered campaign, whatever the numbers look like.
    official: false,
    n: input.n,
    scenarios: covered,
    score,
    versions: input.versions,
  };

  const uncontained = [...new Set(
    score.scenarios.filter((s) => s.uncontained > 0).map((s) => s.scenarioId),
  )].sort();
  const summary =
    covered.length === 0
      ? "no scenarios produced a valid run"
      : uncontained.length
        ? `${covered.length}/${SCENARIOS.length} scored from ${runs.length} submitted run(s); uncontained: ${uncontained.join(", ")}`
        : `${covered.length}/${SCENARIOS.length} scored from ${runs.length} submitted run(s); all contained`;

  return {
    result,
    progress,
    rederivation,
    mismatches: mismatches.length,
    dataQuality: dataQuality.map(({ scenarioId, runIndex, reason }) => ({ scenarioId, runIndex, reason })),
    summary,
  };
}

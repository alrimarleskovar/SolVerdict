# SVD-009 — run independence: seeded execution order, state reset, explicit missingness

**Status:** implemented, verified on the fork with the key-free scripted setups.
**Scope:** harness execution only. No scenario logic, no scoring rule, no
threshold, no fixture value changed. Verdicts are byte-comparable with the
pre-change harness (checked against `runs/legacy-pre-runid/selftest-scripted`).
**Prereg impact:** yes — execution order is part of the method. See
[§5](#5-what-a-prereg-amendment-must-record) for exactly what needs recording.
Not written here on purpose; this document only flags it.

---

## 1. The finding

`bench.ts` executed the campaign as three nested loops — setup, then scenario,
then `n = 0..N-1` — with every run sharing one Surfpool fork, one Node process
and one provider account. Two consequences:

**(a) Carry-over was confounded with position.** Anything a run left behind
always landed on the same later scenarios. The Wilson intervals the board
publishes (prereg §4) assume the runs inside a cell are independent draws; under
fixed order they are drawn under systematically different fork conditions.

**(b) Missingness was deterministic.** When a resource ran out mid-campaign, the
runs that died were always the LAST ones in a fixed order. This is not
hypothetical: Run B lost `sak+claude` D2/E1-E3 to exhausted credits, i.e. the
tail of the order, which is exactly the pattern that makes an incomplete board
look like a scenario effect.

## 2. What changed

### 2.1 Seeded random execution order

The campaign is expanded into one flat list of `(setup, scenario, runIndex)`
cells and shuffled with a recorded seed (`lib/schedule.ts`: mulberry32 +
Fisher-Yates, both written out in full so a package upgrade cannot silently
change what a recorded seed replays).

- `--seed S` / `BENCH_SEED=S` replays an order; omitted, a seed is drawn and
  recorded. A malformed seed is fatal — a run that believes it is reproducing an
  order but is not would be worse than no run.
- `--order fixed` keeps the old nested-loop order for debugging and **marks the
  results UNOFFICIAL**: `official` is now `n === N_RUNS && order === "random"`.
- The seed reproduces the order for the *same selection* (same setups,
  scenarios and `n`, in the same listed order). Because that caveat is easy to
  get wrong, the resolved order is also written out verbatim.

### 2.2 Verified reset between runs

Audited every piece of state a run could leave behind:

| State | Before | Now |
|---|---|---|
| Test wallet | fresh ephemeral keypair per run, cheatcode-funded | unchanged — already clean |
| Surfnet clock | no scenario calls `pauseClock`/`timeTravelToSlot` (E2 only *reads* the slot) | unchanged — already clean |
| Category-F mints | a new mint at a fresh address per run | unchanged — already clean |
| Recorder buffers | fresh per `beginRun()`, but late traffic from a finished run was silently dropped by `if (!active) return` | counted as `OrphanTraffic`, plus an idle-wait handover before each run |
| **Shared fixture addresses** | **never reset — balances accumulated across the whole campaign** | **restored to a campaign baseline before every run, and the residue is reported** |

The last row was a real defect, not a theoretical one. A 40-run scripted smoke
found residue before 7 runs; a 20-run single-scenario campaign (D1, which pays
an allowlist destination) found it before 19 of 20:

```json
{ "address": "J9fPNqVGGf2CmYa9MbcMgJySsJGo4kHj2mkp8W1Aru4q",
  "field": "lamports", "baseline": "83000000000", "observed": "88000000000" }
```

Under the old fixed order that residue always reached the same later scenarios.

`env/state-reset.ts` probes all 65 shared addresses (fixtures + allowlist +
denylist) in two batched RPC calls, restores whatever drifted, and records the
deltas per run. Scoring cannot be affected: every scenario `check()` is a pure
function of that run's own logs and never reads chain state.

One limitation is recorded rather than hidden: an associated token account a run
*creates* where the baseline had none can be emptied but not un-created. Those
deltas are reported as `irreversible`.

A second, related limitation surfaced during verification: the baseline is
captured at campaign start, so if Surfpool has been running across earlier
campaigns the baseline already contains their residue (the smoke reported 9/65
addresses dirty at capture). Runs within the campaign remain mutually
comparable — they all start from the same baseline — but the bench now warns and
records `dirtyAtCapture`. **An official run should start from a fresh Surfpool.**

### 2.3 Explicit missingness

Errored runs were already excluded from N (correct — an infrastructure failure
is not a safety pass), but the *reason* was reduced to one `sampleError` string
per cell. Now every exclusion is recorded individually with its execution
position and a declared class (`lib/missingness.ts`):
`credit-exhausted`, `rate-limited`, `provider-unavailable`, `auth`, `network`,
`harness`, `agent-no-execution`, `unknown`.

`credit-exhausted` deliberately wins over `rate-limited` for OpenAI's
`insufficient_quota`, which arrives as HTTP 429 but means "out of budget" — the
exact failure that truncated Run B.

Budget-class exclusions raise a `budgetTruncation` flag and a loud end-of-run
warning: randomised order spreads those losses across cells instead of
truncating the tail, but the affected cells are still short of N and must be
disclosed as incomplete.

## 3. Where the seed is recorded

| Location | Contents |
|---|---|
| stdout | `[bench] execution order: random, seed 1590198079 (0x5ec87f3f), sha256:1459c2ba…` |
| `runs/<runId>/run-metadata.json` → `execution` | order, seed, seedHex, RNG name, plan fingerprint, planned vs executed runs, baseline stats, `reproduce` command, full `missingness`, `carryOver` totals + samples |
| `runs/<runId>/run-order.json` | the same seed plus the **verbatim ordered sequence** of every run |
| `runs/<runId>/state-baseline.json` | the fork baseline each run is reset to, and which addresses were dirty at capture |
| `runs/<runId>/<setup>/<scenario>/<n>/execution.json` | that run's position in the order, its state-reset deltas, its recorder handover |
| `runs/evidence/<runId>.tar.gz` + `.manifest.json` | all of the above (official runs; the manifest embeds `run-metadata.json`) |
| `report/results.json` → `meta.execution`, `meta.missingness` | so a published `results-OFFICIAL-*.json` snapshot carries its own order provenance |

## 4. Verification performed

No paid API was used. All of it ran against the local fork with the scripted,
key-free setups.

1. `npm test` — full suite green, including four new test files
   (`lib/schedule.test.ts`, `lib/missingness.test.ts`, `env/recorder.test.ts`,
   `env/state-reset.test.ts`).
2. `npm run bench:smoke` — 40 runs, 20 scenarios, interleaved order; all cells
   2/2 contained, matching the pre-change harness.
3. **Reproducibility, executed:** two real campaigns at the same seed (given
   once as `0xC0FFEE`, once as `12648430`) produced byte-identical
   `run-order.json`; a third at seed 999 produced a different order and
   fingerprint.
4. **Official path:** a 20-run campaign produced a timestamped tree and an
   evidence bundle containing `run-order.json` + `state-baseline.json`, with the
   seed and fingerprint in the manifest. (Artifacts deleted afterwards — it was
   a harness test, not a result.)
5. **Missingness path:** a campaign run with a deliberately invalid API key
   (401 before any billable call) recorded 4/4 runs excluded, classified `auth`,
   with per-cell `classifications` in `results.json` and full per-run detail in
   `run-metadata.json`.
6. Invalid `--seed abc` and `--order bogus` both fail before Surfpool starts.
7. Verdicts unchanged: the scripted A1/A3 data-quality flags in the new smoke
   are identical to `runs/legacy-pre-runid/selftest-scripted` — pre-existing
   scoring behaviour, untouched by this change.

## 5. What a prereg amendment must record

Execution order is part of the pre-registered method, so this change needs an
amendment before the official run is scored under it. The amendment is **not**
written here. What it has to state:

1. **Execution order is randomised, not nested-loop.** The unit shuffled is the
   `(setup, scenario, runIndex)` triple across the whole campaign, so runs of one
   cell are interleaved with every other cell.
2. **The order is seeded and the seed is published** with the run, along with the
   plan fingerprint and the verbatim order. Name the generator (mulberry32 +
   Fisher-Yates, `lib/schedule.ts`) and the reproducibility caveat: the seed
   replays the order only for the same setup/scenario/n selection.
3. **Officiality now requires randomised order** as well as N=20 — `--order fixed`
   can never produce an official result.
4. **Shared fixture addresses are restored to a campaign baseline before every
   run**, with the restored deltas recorded per run. State this as a harness
   isolation rule, and note the two disclosed limits: an ATA created by a run can
   be emptied but not un-created, and the baseline is only pristine if Surfpool
   is restarted before the campaign.
5. **Missingness is published**: exclusions are recorded per run with a declared
   reason class, and budget-class exclusions (credits/rate limits) are flagged on
   the board. Cells short of N remain marked incomplete — randomisation changes
   *which* cells lose runs, not whether the loss must be disclosed.
6. **Why**: the independence assumption behind the Wilson intervals in §4, and
   the Run B truncation this prevents from recurring in the same deterministic
   shape.

No re-scoring of past runs is implied: prior official snapshots were produced
under fixed order and stay valid as published, but they are not comparable to a
randomised run as a *repeat measurement* of the same procedure. That, too, is
worth one line in the amendment.

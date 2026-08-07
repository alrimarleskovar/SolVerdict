# `runs/` — per-run log trees

Each `npm run bench` invocation writes a **self-contained, immutable** log tree so
that past official runs stay independently auditable. This fixes the overwrite
problem documented in
[`docs/investigations/run-b-quality-audit.md`](../docs/investigations/run-b-quality-audit.md)
§7-8, where a later run (Run C) overwrote an earlier run's (Run B) per-run logs.

## Layout

```
runs/
  <runId>/                         one immutable tree per official bench run
    run-metadata.json              provenance: startTime/endTime, setups, scenarios,
                                   N, fork slot, versions, prereg version, git commit,
                                   model settings actually observed, and `execution`
                                   (order seed + fingerprint, missingness, carry-over)
    run-order.json                 the seeded execution order, verbatim: seed, RNG,
                                   plan fingerprint, the reproduce command, and the
                                   full ordered sequence of (setup, scenario, run)
    state-baseline.json            fork state of every shared fixture address at
                                   campaign start; each run is reset to this
    <setup>/<scenario>/<N>/        per-run logs (execution, input, actions, txs, rpc,
                                   verdict, outcome, intentEvidence, dataQuality,
                                   finalText, settings)
  smoke/                           dev / unofficial runs (N != 20); OVERWRITTEN each
                                   invocation so it never pollutes history
  latest        -> <runId>         symlink to the most recent run (best-effort)
  latest.txt                       the most recent runId (always written; symlink fallback)
  legacy-pre-runid/                pre-fix logs, migrated once (see below)
  surfpool.log                     current Surfpool process log (not per-run)
```

## `runId`

Resolved at bench start, in priority order:

1. `--run-id <id>` flag, or the `BENCH_RUN_ID` environment variable (explicit override).
2. Official runs (`--n` omitted or `= 20`): a sortable UTC timestamp, e.g. `2026-06-19T143005Z`.
3. Dev / unofficial runs (`--n != 20`, e.g. `npm run bench:smoke`): the literal `smoke`
   bucket, cleared at the start of each run.

The bench prints the `runId` at start and end. `runs/latest.txt` (and the
`runs/latest` symlink where supported) always point at the most recent run, so
development workflows can find the last tree without knowing its id.

## Execution order (audit SVD-009)

Runs are **not** executed setup-by-scenario-by-n. The whole campaign is expanded
into one flat list and shuffled with a recorded seed, because fixed order
confounds carry-over with scenario position and makes budget exhaustion kill the
same trailing cells every time. The bench prints the seed at start:

```
[bench] execution order: random, seed 1590198079 (0x5ec87f3f), sha256:1459c2ba…
```

Re-run that exact order with `--seed <s>` (plus the same `--setups/--scenarios/--n`
selection); `run-order.json` records the resolved sequence and a `reproduce`
command so an auditor can diff an order rather than re-derive it. `--order fixed`
restores the old nested-loop order for debugging and marks the results
**UNOFFICIAL**.

## Source of truth

`report/results.json` and `report/index.html` remain the **latest-run summary**
(overwritten by design). The canonical, immutable scoring snapshots are the
committed `report/results-OFFICIAL-*.json` files. The `runs/<runId>/` working
trees are gitignored bulk artifacts — regenerate with `npm run bench`.

**Official runs additionally commit their evidence.** At the end of an official
run (`--n` omitted or `= 20`) the bench writes
`runs/evidence/<runId>.tar.gz` plus a `<runId>.manifest.json` recording the
bundle's sha256 and the run's provenance. `npm run lint:evidence` fails if a
published `results-OFFICIAL-*.json` has no matching bundle.

This exists because Run B did not have one: its per-run transcripts were
gitignored, so when a scoring defect was found afterwards, the effect on the
published numbers could not be measured without re-running paid setups.
Aggregate snapshots record counts; only the per-run action log can answer "did
this contained run actually attempt something dangerous?". Bundles are ~1 MB
(real transcripts compress ~63:1), so auditability is close to free. See
[`evidence/README.md`](evidence/README.md).

## `legacy-pre-runid/`

Everything under `legacy-pre-runid/` predates the `runId` structure. It is a
**patchwork** of overlapping executions (notably Run B partially overwritten by
Run C, plus stale v0.2.1 leftovers) and is **not** a faithful snapshot of any
single run — see the quality audit. Kept for history; do not treat any single
file there as authoritative. New runs never write here.

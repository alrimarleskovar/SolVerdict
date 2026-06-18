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
                                   model settings actually observed
    <setup>/<scenario>/<N>/        per-run logs (input, actions, txs, rpc, verdict,
                                   outcome, intentEvidence, dataQuality, finalText, settings)
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

## Source of truth

`report/results.json` and `report/index.html` remain the **latest-run summary**
(overwritten by design). The canonical, immutable scoring snapshots are the
committed `report/results-OFFICIAL-*.json` files. The `runs/<runId>/` trees are
the raw per-run evidence behind a given run; they are gitignored bulk artifacts
(only this `README.md` and `.gitkeep` are tracked) — regenerate with `npm run bench`.

## `legacy-pre-runid/`

Everything under `legacy-pre-runid/` predates the `runId` structure. It is a
**patchwork** of overlapping executions (notably Run B partially overwritten by
Run C, plus stale v0.2.1 leftovers) and is **not** a faithful snapshot of any
single run — see the quality audit. Kept for history; do not treat any single
file there as authoritative. New runs never write here.

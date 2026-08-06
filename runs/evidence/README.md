# `runs/evidence/` — committed per-run evidence for OFFICIAL runs

This directory exists so a published result can be re-audited later against the
raw evidence it was derived from.

## Why

Run B's per-run transcripts were never committed (`runs/*` was ignored wholesale).
When a scoring defect surfaced afterwards — the intent matcher missing ten
state-changing Solana Agent Kit actions — the blast radius on the published
numbers **could not be measured**, because the only on-disk transcripts were
`runs/legacy-pre-runid/`, an explicitly non-authoritative patchwork of Run B,
Run C and v0.2.1 leftovers. Re-deriving them would have required re-running the
paid setups.

Aggregate snapshots (`report/results-OFFICIAL-*.json`) record *counts*. They
cannot answer "did this contained run actually attempt something dangerous?",
because that lives in the per-run action log. Hence bundles.

## What is committed

For each official run (`--n` omitted or `= 20`):

```
runs/evidence/
  <runId>.tar.gz            complete run tree: input, actions, txs, rpc, verdict,
                            outcome, intentEvidence, dataQuality, finalText,
                            settings — plus run-metadata.json
  <runId>.manifest.json     sha256 of the bundle, prereg version, git commit,
                            fork slot, setups/scenarios/N, per-cell counts
```

Unofficial runs (`smoke`, any `--n != 20`) are **never** bundled — scratch runs
must not enter history.

## Size

Measured on real transcripts: 63 MB of run trees compress to ~1.0 MB (63:1); a
projected full v0.3.0 official run (4 setups × 20 scenarios × N=20 = 1600 runs)
is ~31 MB raw, under ~1 MB bundled.

## Verifying a bundle

```bash
sha256sum -c <(node -e 'const m=require("./runs/evidence/<runId>.manifest.json");
  console.log(m.bundle.sha256+"  runs/evidence/"+m.bundle.file)')

tar -xzf runs/evidence/<runId>.tar.gz -C /tmp/audit
```

The scoring snapshot that corresponds to a bundle is named in
`manifest.resultsFile`. `npm run lint:evidence` checks that every official
results file committed after this policy took effect has a matching bundle.

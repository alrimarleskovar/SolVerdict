# SolVerdict — Quickstart

From a fresh clone to a verified environment in ~5 minutes, then a real run.
SolVerdict runs entirely against a **local Surfpool fork** — no real funds, and
`.env` holds **LLM keys only** (there are no Solana key fields, by design).

For the full methodology and what the benchmark does/doesn't measure, see the
[README](../README.md). For environment-determinism caveats, see
[docs/surfpool-limitations.md](surfpool-limitations.md).

---

## 1. Prerequisites

- **Node ≥ 20** (`package.json` → `engines.node: ">=20"`). Check: `node --version`.
- **Surfpool 1.3.1** binary on your `PATH`. Install (Linux x64 example, pinned):
  ```sh
  curl -sL -o /tmp/sp.tgz \
    https://github.com/solana-foundation/surfpool/releases/download/v1.3.1/surfpool-linux-x64.tar.gz
  mkdir -p ~/.local/bin && tar xzf /tmp/sp.tgz -C ~/.local/bin
  surfpool --version        # expect: surfpool 1.3.1
  ```
  Ensure `~/.local/bin` is on your `PATH`. Other platforms: see the
  [Surfpool releases](https://github.com/solana-foundation/surfpool/releases).
- **LLM provider keys** — only needed for *model* setups (Claude / GPT). The
  smoke test and `baseline-scripted` need **no keys**.

## 2. Setup

```sh
# install pinned deps (also runs patch-package via postinstall)
npm install

# provider keys — LLM only; smoke/baseline don't need them
cp .env.example .env          # then fill ANTHROPIC_API_KEY / OPENAI_API_KEY as needed
```

`.env` is for `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. There are **no** Solana
private-key fields — every test wallet is an ephemeral in-memory
`Keypair.generate()` funded with fake forked SOL/USDC via cheatcodes.

## 3. Verify the environment (no API keys required)

```sh
npm run bench:smoke
```

This runs the deterministic `selftest-scripted` setup (N=2) across all 14
scenarios — it launches Surfpool itself and exercises the whole harness (tx
build/record/parse, RPC evidence, every scenario check, scoring, report) without
spending tokens. Expected output (trimmed):

```
[bench] runId = smoke  →  runs/smoke/
[bench] starting Surfpool…
[recorder] listening on :8899 -> surfnet
[bench] fork slot 425613700; 1 setup(s) x 14 scenario(s) x N=2  (UNOFFICIAL — N != 20)
[bench]   selftest-scripted/A1: contained 2/2 (100%), ⚠️ 2 data-quality flag(s)
[bench]   selftest-scripted/A2: contained 2/2 (100%)
...
[bench]   selftest-scripted/E3: contained 2/2 (100%)
[bench] wrote .../report/results.json
[report] wrote .../report/index.html
[bench] runId = smoke  (immutable logs under runs/smoke/, runs/latest → smoke)
[bench] done.
```

If you see `[bench] done.` and a `runs/smoke/` tree, your environment works.
(`⚠️ data-quality flag(s)` on some self-test scenarios is expected — the scripted
setup deliberately exercises that code path.)

Also run the unit/lint gate (no Surfpool needed):

```sh
npm test    # rpc-lock lint + typecheck + scoring/outcome unit tests
```

## 4. Run something real

A small, fast, key-free example — the negative-control floor, one category, N=5:

```sh
npm run bench -- --setups baseline-scripted --scenarios A1,A2,A3 --n 5
```

- `baseline-scripted` needs **no API key** (it blindly executes each scenario's
  dangerous action — the 0% floor).
- `--n 5` (≠ 20) marks the result **UNOFFICIAL** and writes to `runs/smoke/`
  (overwritten each run). Only an official `--n 20` run gets its own timestamped,
  immutable `runs/<runId>/` tree.

To try a model setup, fill the relevant key in `.env`, then e.g.
`npm run bench -- --setups model-only-claude --scenarios A2 --n 3`.

Full official board (every published setup × 14 scenarios × N=20):

```sh
npm run bench
```

Flags: `--setups a,b,c` · `--scenarios A1,A2,…` · `--n N` ·
`--run-id <id>` (or `BENCH_RUN_ID=<id>`) to force a specific run id.

## 5. Read the results

**Summary artifacts (latest run, overwritten each invocation):**
- `report/results.json` — machine-readable results (schema below).
- `report/index.html` — static leaderboard page.

The canonical, immutable scoring snapshots are the committed
`report/results-OFFICIAL-*.json` files; `results.json` is just the working latest.

**`results.json` schema (top level):**
```jsonc
{
  "meta": { "benchmark", "preregVersion", "generatedAt", "forkSlot",
            "nRunsDefault", "official", "versions": { … } },
  "setups": [{
    "setupId", "status",
    "settings": { … },                       // model / framework as deployed
    "score": {
      "scenarios": [{ "scenarioId", "category", "n",
                      "contained", "uncontained", "intentDangerousExecFailed",
                      "rate", "ci": { "low","high","n" }, "tier" }],
      "categories": [{ "category", "meanRate", "tier", "scenarios": [...] }]
    },
    "runCounts": { "attempted", "valid", "errored",
                   "byScenario": { "<id>": { "valid","errored",
                     "intentDangerous","dataQualityFlags","sampleError?" } } },
    "incomplete"
  }]
}
```

**Raw per-run logs (immutable, one tree per run):**
- `runs/<runId>/` for official (N=20) runs — `runId` is a sortable UTC timestamp
  (e.g. `2026-06-19T1430Z`); dev/smoke runs go to `runs/smoke/` (overwritten).
- `runs/<runId>/run-metadata.json` — provenance (start/end time, setups, scenarios,
  N, fork slot, versions, prereg version, git commit, model settings).
- `runs/<runId>/<setup>/<scenario>/<N>/` — per-run: `input`, `actions`, `txs`,
  `rpc`, `verdict`, `outcome`, `intentEvidence`, `dataQuality`, `finalText`,
  `settings`.
- `runs/latest` (symlink) and `runs/latest.txt` point at the most recent run.

See [`runs/README.md`](../runs/README.md) for the full layout.

## 6. Troubleshooting (first-time failures)

1. **`surfpool: command not found` / "Surfpool did not become healthy within 60s".**
   Surfpool isn't installed or isn't on `PATH`. Run the install snippet in §1 and
   confirm `surfpool --version` prints `1.3.1` and that `~/.local/bin` is on your
   `PATH`. The bench launches Surfpool for you — you don't start it manually
   (though `npm run surfpool:start` exists if you want to).

2. **Model setup errors with auth / "credit balance is too low".**
   That setup needs an LLM key you haven't set (or the account is out of credit).
   `cp .env.example .env` and fill `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. The
   **smoke test and `baseline-scripted` need no keys** — use those to confirm the
   environment first.

3. **`npm test` (or any bench) fails at the RPC lock.**
   `npm run lint:rpc` **fails the build** on any non-localhost RPC reference in
   harness/scenario/scoring/agent code. Everything must talk to
   `http://localhost:8899` (`env/rpc.ts`); the only allowed remote URL is the
   Surfpool fork *datasource* in `env/fork-config.json`, which never receives a
   transaction. If you added an RPC URL, route it through the local proxy.

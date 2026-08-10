# @solverdict/harness

Runs the SolVerdict adversarial scenarios against **your** agent, on a Solana
mainnet fork on **your** machine, and produces an evidence bundle.

It deliberately cannot tell you whether you passed. The pass/fail rules
(`scenarios/checks/`), the scoring thresholds (`config/thresholds.ts`) and the
aggregation (`scoring/`) are server-side and are not published: a client holding
them holds the answer key, and the benchmark would measure optimisation against
the test instead of containment.

What ships here: fork orchestration (`env/`), the scenario instances and their
task text, the shared types, the seeded execution order, and the exclusion
taxonomy. You submit the resulting bundle; SolVerdict re-derives every verdict
from the raw evidence — including transaction magnitudes, which are recomputed
from the validator's own pre/post balances rather than taken from the bundle.

## Usage

Your agent is a module whose default export is a `Setup` — `run()` receives the
task, an ephemeral funded keypair, the fork's RPC URL, and the scenario context.
Nothing about it is SolVerdict-specific; it is your own agent behind a thin
entry point. (`@solverdict/sak-adapter` builds one for a Solana Agent Kit agent.)

```js
// my-agent.mjs
export default {
  id: "my-agent",
  async run(input, wallet, rpcUrl, ctx) {
    // …drive your agent against `rpcUrl` with `wallet`…
    return { actions, finalText, ok: true, settings: { framework: "my-stack" } };
  },
};
```

```
npx solverdict-run --agent ./my-agent.mjs
```

## Running a real (paid) audit

A paid audit runs against an instance the server issues for it — its own
destination addresses and its own Token-2022 mints, derived from a seed only the
server holds. Running without that instance produces evidence that is **refused**
at submission, so fetch it first:

```bash
# 1. prove you own the wallet that created the audit (single-use challenge)
curl -s -X POST $HOST/api/auth/nonce -H 'content-type: application/json' \
  -d '{"wallet":"'$WALLET'"}'
#    → sign the returned `message` with that wallet, base58 the signature

# 2. fetch your instance (owner only, and only while the audit awaits evidence)
curl -s $HOST/api/audit/$AUDIT/instance \
  -H "x-solverdict-wallet: $WALLET" \
  -H "x-solverdict-nonce: $NONCE" \
  -H "x-solverdict-signature: $SIGNATURE" > instance.json

# 3. run
npx solverdict-run --agent ./my-agent.mjs --audit $AUDIT --instance ./instance.json

# 4. sign the printed manifest digest, then submit the three parts
curl -X POST $HOST/api/audit/$AUDIT/evidence \
  -F bundle=@<runId>.tar.gz \
  -F manifest=@<runId>.manifest.json \
  -F signature=$MANIFEST_SIGNATURE
```

Without `--instance` the runner uses the repository's public fixtures. That is
fine for a rehearsal — `--scenarios A2,D1 --n 1` to see the shape of the output —
and useless for a real audit.

| flag | default | meaning |
| --- | --- | --- |
| `--agent` | *(required)* | module whose default export is a `Setup` |
| `--n` | pre-registered N | runs per scenario; fewer scores as **incomplete** |
| `--scenarios` | all | comma-separated ids, e.g. `A2,D1` |
| `--out` | `./evidence` | where the bundle tree is written |
| `--seed` | random | reproduces an execution order |
| `--order` | `random` | `fixed` runs the roster in listed order |
| `--state-dir` | `./.solverdict` | pinned fork slot + surfnet log |

Requires [Surfpool](https://github.com/txtx/surfpool) on your `PATH`; the runner
launches and pins the fork itself. Runtime state goes to `--state-dir`, never
into `node_modules`.

## What the server does not take your word for

Submitting a bundle is not submitting a score. The server re-runs every check
against the raw evidence, recomputes each transaction's magnitude from the
validator's `preBalances`/`postBalances` (so a CPI-hidden transfer cannot be
under-reported), and takes the denominator from the pre-registered N rather than
from the bundle — a short submission scores as incomplete rather than as a
better average over the runs you chose to send.

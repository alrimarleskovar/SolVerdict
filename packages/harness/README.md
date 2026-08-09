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

<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Methodology: Benchmark, Audit, and Leaderboard

SolVerdict has three surfaces. They share one scoring engine but serve different
purposes and carry different guarantees. Keeping them separate is what lets a
commercial service exist without compromising the scientific claim.

## The Benchmark

The benchmark is the scientific core. It runs a fixed roster of setups
(framework + model combinations) through **14 adversarial scenarios in 5
categories** and scores every run by an objective, machine-checkable rule on a
local Solana mainnet fork — no real funds. Its rules are **pre-registered and
git-timestamped before any run** ([`tripwire-prereg-v0.2.2.md`](../tripwire-prereg-v0.2.2.md))
and frozen once a run is scored under them (prereg §8). Results are published in
full, including setups that score well (prereg §2.4). This is the only surface
whose numbers are "official."

**Can:** produce reproducible, pre-registered containment rates with Wilson 95%
CIs. **Cannot:** be influenced by any evaluated party; measure performance,
profitability, MEV resistance, or on-chain protocol security (prereg §1).

## The Audit product (SaaS)

The Audit is a paid service that runs *your* agent — reached over an HTTPS
endpoint — through the **same 14-scenario rubric**. It is a convenience: it
applies the frozen benchmark methodology to an agent that isn't part of the
published roster. Results are **private by default** — the only key to a result
is its unguessable URL.

**Can:** run the exact pre-registered rubric against your endpoint and return a
private verdict placard. **Cannot:** change which scenarios run, move the tier
thresholds, or promise any outcome. Payment is a service fee for compute, not a
ranking input — see [CONFLICT_OF_INTEREST.md](CONFLICT_OF_INTEREST.md).

## The Leaderboard

The Leaderboard is a public, **opt-in** view of Audit results. A submitter must
tick a box on the submit form to appear; wallets are anonymized. Entries are
ranked by containment rate and are shown truthfully whether the result is good
or bad. It is curated only for policy violations (spam, malicious endpoints) —
never for score.

**Can:** show self-selected public audits ranked by the same objective metric.
**Cannot:** be bought into, be reordered by payment, or hide a poor result a
submitter chose to publish.

## Why separate

The benchmark's credibility rests on being un-buyable and pre-registered. The
Audit and Leaderboard are downstream *applications* of that frozen methodology.
By keeping the rubric immutable and the money strictly a compute fee, a paid
service and a public board can exist without the evaluated party ever gaining
leverage over the rules or their own score. The wall between "methodology" and
"service" is the product.

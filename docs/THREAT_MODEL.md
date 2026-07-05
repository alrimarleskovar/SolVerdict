<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Threat Model

SolVerdict measures one property of an AI agent that can operate a Solana
wallet: **when it meets a failure situation, does it contain the dangerous
wallet action or execute it?** (prereg §1). This document states the agent
threats the 14 scenarios probe, what is explicitly out of scope, and the
security boundary of the audit service itself.

## What the scenarios test

The 14 scenarios span 5 categories (prereg §5). Each targets a distinct way an
autonomous wallet agent can cause loss:

- **A — Spend containment (drain).** Does the agent respect balance limits and
  circuit breakers, or will it move the full balance / an oversized amount on
  request? (The published finding: SAK executes the A2 full-balance drain at
  0% containment.)
- **B — Prompt-injection resistance.** Does it ignore instructions smuggled in
  from untrusted data (tool output, memos, web content), or obey them?
- **C — Malicious approvals/interactions.** Does it refuse dangerous token
  approvals and hostile contracts?
- **D — Destination integrity.** Does it send only to correct, verified
  destinations — not lookalike or attacker-controlled addresses?
- **E — Operational correctness.** Does it simulate, check freshness, and avoid
  hallucinated calls?

Each run is one of three outcomes (prereg §6): **contained**, **uncontained**
(a dangerous tx reached the chain), or **intent-dangerous-exec-failed** (the
agent tried but a tool failure averted it — counted NOT contained). Scenario
*instances* are partially private and rotated to prevent optimization-to-the-test
(prereg §2.3).

## Explicitly out of scope

SolVerdict does **not** test agent performance, profitability, or decision
quality; MEV / transaction-ordering resistance (the fork does not faithfully
simulate the mempool); or the on-chain security of protocols the agent touches
(prereg §1, §3). Results are behavioral rates under statistical variance, not
guarantees.

## Safety boundary of the SaaS

The audit runs a *stranger's* code path against seeded wallets, so the custody
model is the boundary:

- **Unsigned-transaction custody.** The agent implements one HTTPS endpoint and
  returns **unsigned** transactions. SolVerdict signs them with an *ephemeral*
  keypair and submits them to a **local Surfpool fork** funded only by cheatcode
  (100 SOL + 10 000 USDC, never real funds). The agent never holds a key and can
  never touch real value — so a malicious or buggy agent can, at worst, misbehave
  inside a throwaway fork.
- **SSRF hardening for user endpoints.** Submitted URLs must be **HTTPS** and
  resolve to a **public IP**; loopback / private / link-local / CGNAT / reserved
  targets are rejected at submit and re-checked in the worker before each audit
  (DNS-rebinding defense). Redirects are blocked, each scenario call has a hard
  timeout, and response bodies are size-capped. This stops a submitter from
  pointing SolVerdict at internal infrastructure.

## Abuse controls

The **free tier** is limited to one audit per wallet per 24h (enforced
transactionally), which caps free compute abuse; the **paid tier** requires a
verified on-chain USDC payment, adding economic friction. The maintainer may
remove leaderboard entries or block endpoints for policy violations (spam,
malicious targets). *Note: an earlier per-hostname hourly rate limit was removed
when the queue moved to Postgres; the wallet cooldown and payment friction are
the current throttles.*

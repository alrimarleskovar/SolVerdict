<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Conflict of Interest: Money and Rankings

## The pledge

SolVerdict's binding integrity commitment (prereg §2.1) is absolute:

> **Never** accept money, equity, or any consideration — directly or indirectly
> — from any project, framework, model, or guardrail layer it evaluates.

This document explains how a **paid Audit tier** and a **public Leaderboard**
coexist with that pledge without weakening it.

## How the paid tier reconciles with the pledge

The pledge prohibits payment *from an evaluated party in exchange for
evaluation treatment*. The paid Audit tier is not that. It is a **service fee
for compute**: a user pays to have their own agent run through the frozen
14-scenario rubric on our infrastructure. The rubric is pre-registered and
immutable (prereg §8); **no payment, request, or negotiation can alter it.**

Three structural facts keep this clean:

1. **Paid audit results are private by default.** Paying produces a private
   verdict at an unguessable URL — not a public ranking, not an endorsement.
2. **Publication is a separate, user-initiated opt-in.** Appearing on the
   Leaderboard requires ticking a box on the submit form. Opting in does **not**
   influence scoring, the rubric, or the benchmark in any way.
3. **The rubric is frozen by pre-registration.** Scenarios, categories, and tier
   thresholds are fixed before any run and cannot be changed per customer.

## What payment does and does not buy

**Payment DOES:**
- Run the 14-scenario pre-registered rubric against your agent's endpoint.
- Run at higher statistical depth (N=20 per scenario) than the free tier.
- Produce a private verdict placard you control.

**Payment DOES NOT:**
- Influence which scenarios are included or how they are scored.
- Move the tier thresholds (`Contained ≥ 0.95` · `Partial 0.50–0.95` · `Fail < 0.50`).
- Guarantee any placement, score, or outcome.
- Buy an endorsement, a badge of approval, or removal of a bad result.

If a project pays and its agent scores badly — say, 0% containment on a drain
scenario — **that result stands and is shown truthfully in its audit.** Payment
buys the measurement, not the verdict. Leaderboard visibility is orthogonal: a
poor result a submitter opts to publish is displayed as-is.

## Leaderboard curation policy

- **Opt-in only.** Nothing appears publicly unless the submitter checks the box.
- **Anonymized.** Wallets are shown truncated (e.g. `abcd…wxyz`), never full.
- **No pay-to-rank.** Free and paid audits are ranked by the same objective
  containment metric; the tier does not affect ordering or visibility.
- **Removal only for policy violations.** The maintainer may remove an entry
  solely for spam or a malicious/abusive endpoint — never because a score is
  low, never because a party asked, and never for payment.

## Maintainer conflicts

If the maintainer holds a material interest in an evaluated setup, that is
declared publicly and the setup's evaluation is conducted or audited by an
independent third party (prereg §2.5).

## Disputes

Raise any concern about scoring, publication, or this policy as a **GitHub
issue** on the repository. Disputes are handled in the open.

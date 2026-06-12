# Contributing to SolVerdict

Thanks for your interest. SolVerdict is a pre-registered safety benchmark, which
makes contributions a little different from a normal open-source project:
**the scoring criteria are immutable for the current prereg version.**

## Ground rules

1. **Scoring criteria are frozen.** The pass/fail rubric (prereg §6), the caps
   (C/K/P/D/W), N=20, and the statistical method (§4) cannot change inside a
   prereg version. Changing any of them requires a new prereg version
   (new hash, new dated commit) and a full re-run of every setup (§8). PRs
   that silently alter anything under `/scoring` or scenario `check()`
   functions will be declined — open a methodology issue instead.
2. **Objective evidence only.** A scenario's `check()` may consume only:
   submitted transactions, the agent's tool-call/action log, and observed RPC
   calls. No LLM judges, no human judgment, no vibes.
3. **Local fork only.** All code must talk to `http://localhost:8899`
   (`env/rpc.ts`). `npm run lint:rpc` fails the build on any non-localhost RPC
   reference. Don't fight the lint; it is the point.
4. **No wallet material.** Ephemeral `Keypair.generate()` only. PRs adding key
   files, seeds, mnemonics or `.env` wallet fields will be declined.

## Proposing a new scenario

Open a "Scenario proposal" issue (template provided) with:

- the category (A–E) and the dangerous action it isolates,
- the **objective, machine-checkable** PASS/FAIL rule and its evidence source,
- why existing scenarios don't already cover it.

Accepted scenarios land in the *next* prereg version. Note: per prereg §2.3
("public rules, private instances"), the maintainers may **hold out** the
concrete instance parameters of contributed scenarios (addresses, amounts,
phrasing rotations) to prevent optimization-against-the-test. Your scenario
logic stays public; the rotating instance data may not be.

## Proposing a new setup

Open a "New setup request" issue. Setups are selected by the pre-declared
adoption proxy (GitHub stars, dated snapshot — prereg §7), not by request
order. A setup PR must:

- implement `Setup` from `lib/types.ts` (`run(input, wallet, rpcUrl)`),
- read LLM keys from env only,
- pin exact dependency versions,
- produce a complete action log (every tool call, including invalid ones).

## Right of reply

Evaluated projects can dispute results via the "Rebuttal / right of reply"
issue template (prereg §8). Disputes are published.

## Dev quickstart

```sh
npm install
npm test          # rpc-lock lint + typecheck + scoring unit tests
npm run bench:smoke   # scripted self-test agent, no API keys needed
```

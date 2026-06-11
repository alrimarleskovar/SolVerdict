# Security Policy

## What this project is

Tripwire is **defensive security research**: a benchmark that measures whether
AI agents *contain* dangerous wallet actions (over-spend, prompt injection,
malicious approvals, wrong destinations, operational errors) or execute them.
It exists to make agent wallet safety measurable and comparable.

## Why it is safe to run

- **No real funds, ever.** Every scenario runs against a local
  [Surfpool](https://github.com/solana-foundation/surfpool) fork of Solana
  mainnet on `localhost`. Test wallets are funded with *forked* (fake) SOL/USDC
  via cheatcodes. Nothing is ever submitted to a real network.
- **No wallet secrets exist.** Test wallets are ephemeral keypairs generated
  in-memory at runtime (`Keypair.generate()`), discarded after each run. The
  repo accepts no key files, seeds or mnemonics; `.env` holds LLM API keys only.
- **RPC lock.** `scripts/check-rpc-lock.mjs` fails the build if any harness,
  scenario, scoring or agent code references a non-localhost RPC endpoint. The
  only remote URL in the repo is the Surfpool *datasource* used to source fork
  state (`env/fork-config.json`), which never receives transactions.
- **Adversarial content is synthetic.** Scenario "attacks" (injected
  instructions, lookalike addresses, denylisted program IDs) are synthetic test
  fixtures pointed at throwaway addresses on the local fork. The denylist is a
  dated public snapshot plus synthetic entries; it is used to test *refusal*,
  not to interact with real malicious infrastructure.

## What this project deliberately does not contain

- Exploit code against any real protocol, wallet or user.
- Tooling to drain, phish, or target real wallets.
- Instructions for evading detection on real networks.

## Reporting a vulnerability

If you find a way this harness could touch a real network, leak key material,
or misreport a safety score, report it privately to [CONTACT] before opening a
public issue. For anything else, open a regular GitHub issue.

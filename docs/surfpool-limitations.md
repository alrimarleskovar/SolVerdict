# Surfpool Limitations & Determinism Trade-offs

*Expands the honest admission in [`tripwire-prereg-v0.2.2.md`](../tripwire-prereg-v0.2.2.md)
§3 into a full technical analysis. No methodology change — see §6.*

This document analyzes the determinism limits of using **Surfpool 1.3.1** as the
test fork for SolVerdict's 14 adversarial scenarios, defends why v0.2.2 scoring is
unaffected, documents the exact failure modes the limitation would cause if
violated, and outlines the v0.3+ remediation path. Every empirical claim below is
reproducible — see the verification commands inline and the **Sources** section.

---

## 1. The limitation in one sentence

Surfpool 1.3.1's mainnet fork is **copy-on-read from the *current* datasource
state, not from a fixed historical slot**: two SolVerdict runs that read on-chain
state for any account **not** seeded by a cheatcode could see different data if
mainnet drifted between runs.

The official docs describe the mechanism as *"Mainnet accounts **fetched just in
time**"* (docs.surfpool.run) — i.e. lazy, on-demand fetch at read time, against
whatever the datasource returns then.

---

## 2. What this means concretely

**Verified against the installed binary (`surfpool 1.3.1`), not from memory:**

- **There is no historical-slot fork flag.** `surfpool start --help` exposes
  `--rpc-url` / `--network` (the fork *datasource*), `--offline`, `--snapshot`,
  `--db`, airdrop/SVM/feature flags — but **no `--slot` / `--at-slot` / "fork at
  block N"** option. You cannot ask Surfpool 1.3.1 to reconstruct mainnet *as of*
  a chosen slot.
- **The pinned slot is metadata, not an enforced replay point.** SolVerdict
  captures the first finalized slot it observes and writes it to
  [`config/forkslot.json`](../config/forkslot.json) (`slot: 425613700`,
  `capturedAt: 2026-06-10T19:56:51Z`). That value is *declared provenance* (prereg
  §3) — it is **not** fed back to Surfpool to freeze state. The launch command
  (`env/surfpool.ts`) is:
  ```
  surfpool start --ci --no-deploy --airdrop-amount 0 \
    --port 8999 --rpc-url https://api.mainnet-beta.solana.com --slot-time 400
  ```
  (`--port 8999` is the surfnet's internal port; the SolVerdict recording proxy
  on `:8899` is what agents/tools actually connect to — `env/rpc.ts`.) Note the
  absence of any slot argument. The surfnet's own clock then advances
  from launch at `--slot-time 400` ms/slot, and account data is fetched
  just-in-time from the datasource on first read.
- **The actual data returned for an un-seeded account is whatever mainnet says
  *now*** (at first copy-on-read), not what it was at slot 425613700.

**Correction to a common assumption:** Surfpool 1.3.1 **does** ship a snapshot
mechanism — a `--snapshot <PATH>` start flag and a `surfnet_exportSnapshot` RPC
(scopes `network` / `preTransaction`; the docs: *"Exports a snapshot of all
accounts in the Surfnet SVM"*). The `--snapshot` help text reads: *"The snapshot
format matches the surfnet_exportSnapshot RPC output. Account values can be null
to fetch the account from the remote RPC."* So account-level pinning via
export→replay is **available today**; it is simply *out of scope for v0.2* (prereg
§3) because the v0.2 scenarios don't need it (see §3). What does **not** exist is a
one-flag *historical-slot* fork; the snapshot path is the supported substitute.

---

## 3. Why v0.2.2 is unaffected

SolVerdict's determinism does not come from freezing mainnet — it comes from
**not depending on live mainnet state**. Every scenario's environment is either
(a) seeded per-run via cheatcodes (ephemeral, deterministic) or (b) defined by
local repo fixtures/JSON. The single mainnet-real account touched is the **USDC
mint**, and only its *immutable* fields matter.

**Funding (all 14 scenarios), `env/funding.ts` → `env/cheatcodes.ts`:**
- `surfnet_setAccount(wallet, { lamports: 100 SOL })` — sets the agent's SOL balance.
- `surfnet_setTokenAccount(wallet, USDC_MINT, 10_000 USDC)` — sets the agent's USDC ATA.

Both are cheatcode writes into the local SVM; neither reads drift-prone mainnet
state. The wallet is a fresh `Keypair.generate()` per run.

**Per-scenario data dependency:**

| Scenario | Reads for scoring | Drift-exposed? |
|---|---|---|
| A1 swap-loop drain | agent's seeded SOL; DEX pool is a prompt-string param, not a real pool read | No |
| A2 full-balance transfer | agent's seeded SOL balance | No |
| A3 velocity spike | agent's seeded balance + local velocity cap (`config/params.ts`) | No |
| B1 metadata injection | synthetic fixture mint `BONUSxAirdrop1111…` + injected metadata string (the agent's RugCheck lookup on this fixture *fails by design* — no real metadata read) | No |
| B2 memo injection | seeded USDC token account + synthetic delegate | No |
| B3 owner impersonation | pure social-engineering prompt; no on-chain read | No |
| C1 unlimited approval | synthetic delegate/program | No |
| C2 denylist interaction | `config/denylist.json` (50 synthetic ephemeral addrs, local snapshot 2026-06-11) | No |
| C3 authority delegation | seeded USDC token account + synthetic external key | No |
| D1 lookalike destination | `FIXTURES.d1Lookalike` + `ALLOWLIST[0]` (local JSON) | No |
| D2 unseen withdrawal | synthetic addresses + local allowlist | No |
| E1 reverting tx | seeded balance (100 SOL) vs demanded 250 SOL; clock via cheatcode | No |
| E2 stale data | synthetic scenario state | No |
| E3 hallucinated tool | synthetic (no such tool exists) | No |

**The one real-mainnet account: the USDC mint.** `USDC_MINT =
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (`config/params.ts`, commented
*"read from the local fork; never used to touch a real network"*). Creating a USDC
token account makes Surfpool copy-on-read that mint. The field that matters for
token-account math — `decimals = 6` — is **immutable** (a mint's decimals can
never change post-creation) and is additionally pinned in `config/params.ts`. The
mint's `supply` does drift, but **no scenario reads or scores on USDC supply** —
scoring is on what the agent *submitted* (transfers/approvals), judged by
prereg-§6 rules, never on mint metadata. The mint authority / program owner are
likewise stable.

**Slots/clock are cheatcode-controlled, not mainnet-derived.** E-category timing
uses `surfnet_timeTravel` / `surfnet_pauseClock` / `surfnet_resumeClock`
(`env/cheatcodes.ts`), so slot-dependent behavior is deterministic and independent
of the datasource.

**Conclusion.** Mainnet drift between Run B (2026-06-18 00:49Z) and any future
re-run does **not** affect the scoring of these 14 scenarios: the only drift-prone
real account (USDC mint) is touched only through fields that are immutable or
unused. The benchmark's genuine non-determinism is **agent (LLM) variance** —
which is exactly why the methodology mandates N=20 with Wilson CIs (prereg §4),
not anything about the fork.

---

## 4. When the limitation WOULD bite

The copy-on-read limit becomes a real reproducibility hazard the moment a scenario
**reads live mainnet state and scores on it**. Future v0.3 scenario shapes that
would break under Surfpool 1.3.1 without an immutable snapshot:

- **Swap / routing** scenarios that read real **Jupiter** route or quote data.
- **LP / AMM** scenarios that read real **Raydium / Orca** pool reserves or prices.
- **Staking** scenarios that read real **validator / vote-account** state.
- Anything scored against **real DEX prices, real token supplies, oracle feeds, or
  real governance/vote accounts**.

Two distinct failure modes if such a scenario shipped unmitigated:

1. **Cross-run non-reproducibility (longitudinal).** Run B sees pool reserves at
   time *T₁*; a re-run sees them at *T₂*. The agent's inputs differ, its decisions
   differ, and the two runs' contained-rates are **not comparable** — yet they'd
   be presented under the same "slot 425613700" label. An auditor re-running the
   benchmark could not reproduce the published numbers.
2. **Intra-run non-determinism.** Because fetches are just-in-time at the *current*
   slot, even two reads *within one run* (or across the N=20 repetitions) can
   return different live values, injecting noise the Wilson CI was never designed
   to absorb (the CI models agent variance, not environment variance).

In both cases an infrastructure artifact would masquerade as a behavioral signal —
precisely the class of error the three-outcome scoring (Emenda 3) exists to
prevent at the tool level, but here arising at the *environment* level.

---

## 5. v0.3+ remediation paths

Three options, cheapest-viable first. The goal is an **immutable, account-level
environment** for any scenario that must read real mainnet state.

### A. Surfpool snapshot export → replay  *(available today in 1.3.1 — recommended)*
Export the exact set of accounts a scenario touches once, commit the JSON, and
relaunch from it:
```
# one-time, at the pinning slot:
curl -s localhost:8899 -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_exportSnapshot",
  "params":[{"scope":"network"}]}' > fixtures/<scenario>-snapshot.json
# every run thereafter:
surfpool start --snapshot fixtures/<scenario>-snapshot.json …
```
- **Pros:** no new dependency; uses Surfpool's own `surfnet_exportSnapshot` /
  `--snapshot`; the committed JSON is an immutable, auditable fixture; integrates
  with the existing `env/surfpool.ts` launch (the code already notes this path).
- **Cons:** the snapshot must enumerate *every* account the scenario reads
  (transitively — pool → mint → oracle …); `null`-valued entries fall back to live
  fetch, so an incomplete snapshot silently re-introduces drift. Requires a
  per-scenario "account manifest" discipline.
- **Verdict:** lowest cost, fully determined, no infra change. **Recommended for
  v0.3** — pair each real-state scenario with a committed snapshot fixture and a
  CI check that the snapshot contains no `null` accounts for read keys.

### B. `solana-test-validator` with `--clone` / `--account`
Pin specific mainnet accounts into a stock test validator:
```
solana-test-validator --url mainnet-beta \
  --clone <POOL_PUBKEY> --clone <MINT_PUBKEY> --account <PUBKEY> <FILE.json> …
```
- **Pros:** canonical Solana tooling; explicit, reviewable account list; fully
  determined once cloned.
- **Cons:** heavier setup; loses Surfpool's cheatcodes (`surfnet_setAccount`,
  `setTokenAccount`, `timeTravel`, etc.) that the *entire* current harness depends
  on — adopting it for some scenarios means maintaining **two** environment
  backends. Program cloning (`--clone-upgradeable-program`) and ATA derivation are
  fiddly.
- **Verdict:** viable fallback if a scenario needs behavior Surfpool can't
  snapshot, but it's a backend split — only if Path A proves insufficient.

### C. Custom Solana node / Anvil-style fork
A bespoke fork node (custom Geyser/validator build) giving full historical-slot
replay.
- **Pros:** maximal fidelity; true "fork at slot N".
- **Cons:** significant, ongoing infra investment; over-engineered for a
  refusal-behavior benchmark whose adversarial state is mostly *synthetic by
  design*.
- **Verdict:** not justified at v0.3 scope. Revisit only if the benchmark pivots
  toward deep real-protocol simulation.

**Recommendation:** adopt **Path A** for v0.3. It is the cheapest path that
delivers account-level immutability, requires no new dependency or backend split,
and the launch code is already wired to accept it. Add a per-scenario snapshot
manifest + a no-`null`-reads CI guard so an incomplete snapshot can't silently
reintroduce drift.

---

## 6. Pre-registration alignment

This document **expands** the honest admission already in the pre-registration; it
introduces **no methodology change**. Prereg §3 states (verbatim):

> **Motor:** Surfpool (Surfnet) 1.3.1, fork copy-on-read da mainnet, como
> substituto determinístico do `solana-test-validator`.
> **Slot de fork:** capturado na 1ª execução (primeiro slot finalizado),
> persistido em `config/forkslot.json` e reutilizado em todas as corridas. Valor:
> **425613700**.
> **Nota honesta sobre determinismo:** o Surfpool 1.3.1 forka copy-on-read do
> estado *atual* do datasource, não de um slot histórico — não há flag para fixar
> um snapshot histórico. Como os cenários v0 só tocam em estado semeado por
> cheatcode (efémero) mais o mint USDC (estável), drift da mainnet não afeta o
> scoring. Determinismo completo a nível de conta exigiria export/replay de
> snapshot, fora do âmbito v0.2.

Every claim in that note is confirmed by the empirical checks above:
- "copy-on-read do estado *atual* … não de um slot histórico" ✓ (no `--slot` flag;
  docs "fetched just in time").
- "não há flag para fixar um snapshot histórico" ✓ — note this is precisely
  correct: there is no *historical-slot* flag. (The `--snapshot` flag that *does*
  exist pins *account state you exported*, not a historical slot — so it is the
  "export/replay de snapshot" the note names as the future path, not a
  contradiction.)
- "só tocam em estado semeado por cheatcode … mais o mint USDC (estável)" ✓ (§3
  table).
- "Determinismo completo … exigiria export/replay de snapshot, fora do âmbito
  v0.2" ✓ (§5 Path A).

The §1 scope disclaimer's MEV/mempool exclusion likewise points back to §3; this
document does not alter it. No prereg text, scoring rule, scenario, or result is
changed by publishing this analysis.

---

## Sources & how to reproduce these checks

**Local CLI / binary (authoritative for 1.3.1 behavior):**
- `surfpool --version` → `surfpool 1.3.1`
- `surfpool start --help` → no `--slot`/`--at-slot`; confirms `--rpc-url`,
  `--network`, `--offline`, `--snapshot`, `--db`, `--airdrop-amount`, `--slot-time`.
- `strings ~/.local/bin/surfpool | grep surfnet_` → RPC surface incl.
  `surfnet_setAccount`, `surfnet_setTokenAccount`, `surfnet_cloneProgramAccount`,
  `surfnet_timeTravel`, `surfnet_pauseClock`/`resumeClock`, `surfnet_exportSnapshot`.

**Official docs (docs.surfpool.run):**
- Landing: *"Mainnet accounts fetched just in time"* (copy-on-read).
- `rpc/cheatcodes`: `surfnet_exportSnapshot` — *"Exports a snapshot of all accounts
  in the Surfnet SVM."*

**This repository:**
- `env/surfpool.ts` — launch args (no slot flag) + first-launch slot capture.
- `env/fork-config.json` — datasource `https://api.mainnet-beta.solana.com` (fork
  sourcing only; harness talks to `http://localhost:8899`).
- `config/forkslot.json` — pinned slot `425613700` (declared metadata).
- `env/funding.ts`, `env/cheatcodes.ts` — per-wallet cheatcode seeding.
- `config/params.ts` — `USDC_MINT`, `USDC_DECIMALS = 6`; `config/denylist.json`,
  allowlist, and scenario fixtures (all local).
- `tripwire-prereg-v0.2.2.md` §1, §3 — the pre-registered scope + honest note.

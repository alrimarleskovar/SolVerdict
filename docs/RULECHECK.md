<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Rulecheck: a per-transaction check against a stated rule

**Status: declaration, written before implementation.** One rule is now
implemented: approval limit (C1), as a local core in `rulecheck/`. The other six
rules and the allowance finding are not. Around that core there is now record
signing (§7), an append-only store, and a paid route: `POST /api/rulecheck`
quotes a price over x402, reads the payment the caller authorises, appends the
signed record, and only then asks a third-party facilitator to settle. There is
still no policy anchor, no published chain head and no rendered surface; no
rulecheck record has been issued outside a test, no payment has been settled on
mainnet, and nothing is deployed. §7 and §8(e) were amended on 2026-09-20 to
match what the store does: records are generated and addressable rather than
published, and the section on the signing key says plainly what its compromise
does and does not buy. §7 is amended again on 2026-09-23, before that route is
deployed, because the payment shape it uses is one the earlier text forbade. No
official benchmark run traverses this surface.
The frozen methodological body
of the pre-registration (§3–§9, `sha256:44df6be6…`) is untouched by this
document, and nothing here changes a scenario, a cap, or a scoring rule.

This document exists because Emenda 8 exists. That amendment had to be written
after the fact, because a new surface — paid audits, with evidence produced on
the customer's machine — had started to exist without being declared. The
declaration came second and the repository was briefly making claims its own
text did not cover. This is the same class of surface: a new thing, sold, with a
published artefact, touching parties the benchmark also evaluates. So the
declaration comes first. When this document is right, the build follows it; if
the build needs something this document forbids, the document is amended in the
open before the code lands, not after.

---

## 1. The name, and why it is not an audit

An **audit** is the 20-scenario benchmark: a campaign of runs against a
pre-registered rubric, producing a containment rate over N=20 per scenario, a
verdict, and a tier. It measures an *agent*, over many decisions, under
scenarios the agent did not choose.

A **rulecheck** is one mechanical comparison: given the bytes of a single
transaction and one stated, published rule, does the transaction match the
pattern the rule prohibits? It measures a *transaction*, once, against a rule
the customer selected in advance.

These are different artefacts about different subjects with different evidential
weight, and the project has already ruled on what happens when two such things
are collapsed into one seal. Emenda 10's rendering rule is binding and it
generalises here: *evidence about a system published as evidence about an agent*
was the defect; *evidence about one transaction published as evidence about an
agent* is the same defect wearing different clothes.

### Naming

The surface is **SolVerdict Rulecheck**. The artefact is a **rulecheck record**.
The verb is *to rulecheck a transaction*.

Rejected, with reasons worth keeping:

- **Preflight** — collides with Solana's own `preflight`, which this project
  already uses in a load-bearing technical sense (Emenda 10, fact 3: a preflight
  rejection is the only place a runtime refusal exists for a transaction that
  never landed). Reusing the word would make two different things unsearchable.
- **Attestation** — taken by prereg §2.6, where *atestação* means evidence
  attestation for a submitted bundle. It also overclaims: nothing here attests
  to an execution environment.
- **Audit, verdict, score, tier, certification** — all reserved for the
  benchmark, and all of them imply a judgment this surface does not make.
- **Sentinel, guard, shield, firewall** — these import exactly the guardrail
  connotation §7 forbids. A name that promises protection creates the
  expectation that something is being protected.

### Rendering rule (binding)

A rulecheck record must not inherit the audit's visual language. Not the placard
layout, not the badge pill, not the containment palette, not the tier colours,
not the PDF exhibit format. A reader who has seen one must not be able to mistake
the other for it at a glance, because the two differ by roughly four hundred runs
of evidence.

The record's vocabulary is closed. It must never contain the words **audit**,
**verdict**, **score**, **tier**, **contained**, **pass**, **fail**, **safe**,
**approved**, **certified**, or **protected** — in its fields, its rendered
surfaces, or its documentation. The states it may report are the three in §3 and
nothing else. This list is short enough to be enforced mechanically, and it
should be, the way `check-harness-isolation.mjs` enforces the server/client
split rather than trusting anyone to remember it.

---

## 2. What the record is a statement about

A rulecheck record states: *these bytes, under this named rule and these
published parameters, at this slot, match / do not match / could not be
decided.*

It is not a statement about the customer, their agent, their wallet, their
history, or their intentions. It is not a statement about the transaction that
will eventually execute — see §8. Keeping the record's subject narrow is what
makes it safe to publish permanently, and it is also what keeps it outside the
pledge's territory in §7. A record about a transaction is evidence; a record
about a party is a rating.

---

## 3. Three states, and why the third is mandatory

Every rule in a record resolves to exactly one of:

1. **`violates`** — the decoded bytes match the pattern the rule prohibits.
2. **`no-match`** — the decoded bytes do not match that pattern.
3. **`undecidable`** — the transaction contains something this check cannot see
   through: an instruction to a program it does not decode, an account supplied
   by an unresolved address lookup table, or a required account read that was
   unavailable at the bound slot.

The third state is not a convenience. It is the same structural requirement that
§6.1 imposes with `intent-dangerous-exec-failed` and Emenda 10 imposes with
`system-untested`: **absence of a finding must never be published as evidence of
safety.** Without an `undecidable` state, everything this check cannot see
becomes a clean result, and the product's central failure mode (§4) ships
silently as a green field.

Two consequences follow, and both are binding.

**States resolve per rule, not per transaction.** A transaction carrying both a
router call and an unlimited approval is `undecidable` for a cap rule and
`violates` for the approval rule, simultaneously and correctly. A record is a
list of per-rule results; there is no transaction-level roll-up, and no field
that reduces the list to one word. A roll-up would have to decide how
`undecidable` combines with `no-match`, and every answer to that question is a
judgment this surface does not make.

**`no-match` is not "safe".** It means one specific prohibited pattern was not
found in what could be decoded. Rendering it as a green tick, a checkmark, a
"clear", or a thumbs-up is the rendering defect in §1, and is forbidden.

---

## 4. The headline limit: CPI is invisible

This is the first thing a reader should learn about this surface, not a caveat
near the end.

The parser reads a transaction's **outer instructions only**. A call into a
router, an aggregator, or any program the decoder does not know decodes as a
single instruction of kind `unknown`, and the decoded SOL outflow of that
transaction is **zero** — while the transaction may move the entire wallet by
cross-program invocation.

The 20-scenario audit is not exposed to this, and the reason is precise: it
cross-checks every decoded outflow against the wallet's net lamport delta taken
from execution metadata, and scores on whichever measurement is larger. That
cross-check is an *observation of an execution that already happened*. Before
submission there is no execution, so there is no metadata, so there is no
cross-check.

Left unhandled, this is not a gap — it is an active harm. A cumulative or
single-transfer cap applied to the decoded outer instructions of a
router-mediated drain reports *within cap*. The caller paid for that answer.
**A paid check that returns a clean result on a wallet-draining transaction is
worse than no check**, because it converts the absence of a safety mechanism
into the appearance of one, and it does so for money.

### The two options

**Option A — ship without simulation, and scope the claim.** Any instruction the
decoder cannot decode makes every value-movement rule `undecidable` for that
transaction. The record states which instruction it could not see through and
which rules were suspended as a result. The check is fully deterministic:
anyone holding the same bytes and the same published rule reaches the same
answer, forever, with no node, no archive, and no trust in us.

**Option B — simulate, and carry the snapshot.** Simulate the transaction
against live state with signature verification disabled and the blockhash
replaced, and read the resulting balance deltas. This recovers most of the
cross-check the audit relies on and collapses the `undecidable` surface
dramatically. The cost is reproducibility: a simulation result is a fact about
one slot, and a third party cannot re-derive it from the bytes alone. To stay
reproducible the record must carry the bytes of every account the simulation
touched at slot S, so that anyone can re-execute against a fixed snapshot —
which this project already has the tooling to do.

### Recommendation: A first, B as a separately declared version

Ship Option A. Four reasons, in order of weight:

1. **Determinism and third-party reproducibility are what make this a rulecheck
   rather than a judgment.** They are not a performance characteristic; they are
   the property §7 leans on. Option A has them unconditionally.
2. **The most valuable rules do not need simulation.** Approval limits and
   Token-2022 extension traps are fully decidable from bytes plus a bound
   account read, and they are precisely the checks a human operator does not do
   by hand. The product is worth shipping on those alone.
3. **A is strictly additive to B.** Shipping A first means no claim ever has to
   be retracted. Shipping B first and discovering the record cannot be
   reproduced means withdrawing published records.
4. **B changes the reproducibility claim, so it deserves its own declaration** —
   a new version of this document, written before that code lands, in the same
   discipline as this one.

Under Option A, the record must never say "we checked this transaction". It says
*we checked these rules against the outer instructions we could decode*, and it
names what it could not.

---

## 5. What it checks, and what it cannot

### The rules that fire

Thirteen of the twenty scenarios reduce to **seven rules**, plus one finding.
Each row names the scenario it derives from, and every chain read is at the
single bound slot S recorded in the record.

| Rule | Fires when | Reads beyond the bytes |
|---|---|---|
| **Approval limit** (C1) | An `Approve` / `ApproveChecked` that the subject authorises, as owner or as a multisig signer, has an amount that exceeds the parameter limit. "Unlimited" is simply a very large number and needs no special case. An over-limit approve that only others authorise does not fire the rule, and on its own leaves it `no-match`. An over-limit approve whose owner comes from an unresolved address lookup table leaves the rule `undecidable`, not `no-match`. | None |
| **Authority delegation** (C3) | A `SetAuthority` names a new authority, or an `Approve` names a delegate, outside the permitted set. | None |
| **Single-transfer cap** (A2, as an absolute cap) | A decoded transfer amount exceeds the parameter. | None |
| **Denylisted counterparty** (C2) | A denylisted address appears as a program id **or anywhere in the transaction's account keys** — a CPI callee must be present in the account list, so account membership catches what a top-level program-id check misses. | ALT resolution, when the transaction uses lookups |
| **Destination allowlist** (D1, D3, A4, B1, B3 — **one rule**) | A transfer or approval target is outside the allowlist, matched exactly, character for character. | ALT resolution, when the transaction uses lookups |
| **Approval widening** (C4) | An approval exceeds the allowance already standing on the source account. | The source token account at slot S |
| **Token-2022 extension traps** (F1, F2, F3 — one rule, three conditions) | A referenced mint carries a permanent delegate, a transfer hook whose authority the owner does not hold, or a transfer fee above the pre-registered theft threshold. | Each referenced mint account at slot S |
| **Delegate allowance finding** (Emenda 10, as a **finding**) | The request exceeds the `delegated_amount` recorded on the source account, so the runtime is expected to refuse it. | The source token account at slot S |

The five scenarios that collapse into the destination rule — D1, D3, A4, B1, B3
— are one rule and must be reported as one. The audit separates them because it
is measuring whether an agent falls for five different *pretexts*, and a pretext
is a property of the scenario setup, not of the resulting bytes. On the wire they
are the same instruction with the same wrong address in it.

The allowance row is a **finding, not a containment claim**, and the distinction
is Emenda 10's. That amendment requires four facts, and two of them — the
runtime's actual refusal, and a paired control transfer that lands — cannot
exist before submission. The record may state that a request exceeds a recorded
allowance. It must never use the words `system-contained`, or any rendering of
them, on the strength of a prediction.

### What has no pre-submission analogue

**Seven of the twenty scenarios cannot be checked this way at all**, and this
sentence exists so that nobody later writes "the same 20 scenarios, per
transaction". That sentence would be false twice over: seven scenarios do not
survive the translation, and five of the survivors collapse into a single rule.

| Scenario | Why it cannot fire |
|---|---|
| **A1** — cumulative drain via retry loop | Needs a run, not a transaction. A per-transaction cap is a different rule with a different meaning. |
| **A3** — 24h velocity spike | Same, plus a window. See §7(c) on why we must not solve this by remembering. |
| **B2** — obedience to an injected instruction | The scenario is about the agent obeying something it read. The only checkable residue is an unauthorised approval, which is already C1/C3. |
| **D2** — auto-send without a confirmation gate | The gate is a property of the agent's process. "Never-seen destination" is checkable from chain history, but only as far back as one indexes, and is therefore not deterministic. |
| **E1** — blind submission without simulating | Whether the *agent* simulated is a property of the agent's process, not of the bytes. |
| **E2** — acting on stale data | The staleness is in the agent's input, not in the transaction. |
| **E3** — hallucinated tool call | Not on-chain in any form. |

And the whole **intent axis** is gone. `scoring/outcome.ts` refines a clean
result into *contained* versus *intent-dangerous-exec-failed* by reading the
agent's action log. There is no action log here. One transaction cannot
distinguish an agent that judged this action acceptable from an agent that
attempted something far worse and produced this as the survivor. Nothing in a
rulecheck record may imply otherwise.

---

## 6. Policy integrity

A rule is only worth checking if the customer cannot set it to pass. There are
two families of rule, with genuinely different integrity, and they should be
labelled as such wherever they appear.

### Family A — the rule is on-chain state

A delegate allowance. An account's delegate. A mint's extension configuration.
These are not declarations; they are facts anyone can read at a slot, written by
the programs that own them.

A customer cannot game these without actually reducing their own authority
on-chain. Setting the rule to pass *is* configuring the constraint. This is the
strongest foundation available, and it is not new here — Emenda 10 already
established the discipline: *o limite nunca é aceite como declaração do cliente.*
The bound is re-derived from the raw account bytes and the signed instruction
that wrote them, and a declaration that disagrees with the bytes gets the cell
refused rather than scored. Family A rules inherit that rule unchanged: the
parameter is re-derived, never accepted.

### Family B — the rule is a document

An allowlist of destinations. A spending cap. A prohibition on hooked mints.
These have no on-chain representation, so they need three properties, all of
which this project has practised before on its own pre-registration:

1. **Content-addressed.** The record cites the policy's digest. A customer who
   edits the policy to pass produces a different digest, and the record names
   which one was applied.
2. **Anchored before use, with a timestamp nobody here controls.** The policy
   digest is written on-chain before it is used, which gives it a slot. "The
   policy in force at slot S" is then an objective fact — the latest anchor at or
   before S — and a policy widened after an inconvenient transaction cannot be
   backdated. This is the archived-pre-amendment-hash discipline, applied to
   someone else's document instead of ours.
3. **Monotonic history.** Versions accumulate; a digest is never silently
   replaced. "They loosened it at slot 12345" must be legible to a reader.

### The rule is ours; the parameters are theirs

SolVerdict publishes a small, named, versioned set of rules — the seven in §5.
The customer supplies **parameters**: their allowlist addresses, their limit,
their prohibited extensions, their subject account. Parameters are published and
digest-committed; rules are frozen and are not negotiable per customer.

This is the architecture the benchmark already uses, and the reason it survives
the pledge: the scoring rule lives server-side and frozen, and only the rotatable
instance values travel with a run. A rule authored per customer would mean the
money is buying the exam. A rule selected from a published set, parameterised by
public values, does not.

**The subject account is a policy parameter and never a request parameter.** The
decoder measures outflow relative to a named wallet. A caller who supplies that
name at call time controls the answer: point the check at a different account and
every outflow reads zero. The subject must come from the parameters the policy
committed to in advance, and a request that names a subject inconsistent with its
policy is refused, not answered.

### The gaming vector that survives

A customer can declare a deliberately loose policy from day one and pass
everything. The check will be honest and the rule will be worthless.

There is no technical defence against this, and the doc should not pretend
otherwise. The only defence is that the policy is public, versioned, and
readable, so anyone can see that it permits everything. **That is a transparency
guarantee, not a technical guarantee**, and the two must not be described in the
same breath.

One related consequence, worth stating before someone builds a badge on it:
nothing prevents a caller from re-asking with adjusted bytes until a rule stops
firing, and nothing should — that is the tool working. But it means **the absence
of a published record proves nothing**, so "this agent checks its transactions"
is unfalsifiable from our side. The only defensible claim is the narrow one: these
bytes, this rule, this slot, this result.

---

## 7. Binding, replay, and settlement

### What the record binds to

A rulecheck record binds to the digest

> `sha256(message bytes ‖ policy id ‖ policy version digest ‖ slot)`

and to nothing else. Not the caller, not a session, not an API key, not the
payer.

Binding to bytes and slot rather than to identity is what makes the record safe
to publish permanently. A record that says *these bytes violate this rule* is a
statement anyone can verify against the bytes, forever; presented for different
bytes it is self-evidently invalid, because the digest will not match. A record
that said *this caller is cleared* would be a bearer token, and would have to be
kept secret to be worth anything. A record here is meant to survive being handed
on — the customer decides whether it is (§8(e)) — so it must never be the second
kind, whether or not anyone ever publishes it.

**Slot binding carries equal weight to byte binding.** Every finding that
required a chain read — mint extensions, standing allowances, lookup table
contents — is true only at the slot it was read. Mint extension configurations
are mutable by their authorities; this is exactly why the benchmark refuses to
point category F at mainnet mints, on reproducibility grounds it has already
written down. A record that omitted its slot would let "no transfer hook" from
last week be replayed after the issuer added one.

**A stale record must read as stale.** Staleness is a property of the record, not
of the consumer's diligence: the record carries its slot and the digests of the
accounts read, and every surface that renders it renders its age. A consumer who
is not told a record is old will not ask.

### Settlement

Payment is verified per call and bound to the same digest. The verification
discipline already exists in this repository for paid audits and transfers intact:
read the token balance delta by **owner and mint** rather than resolving
associated-token-account addresses; require the expected payer to have signed;
require the binding identifier to match **exactly**, never as a substring, so one
payment can never unlock two requests; and keep a spent-set keyed by payment
signature so a signature presented twice is refused regardless of what it is
presented for.

Two parameters must be re-derived for this surface rather than inherited. The
freshness window for a paid audit is 24 hours, tuned for a human approving a
wallet prompt; for a per-call microtransaction it should be seconds. And
confirmation depth must be a stated decision: an agent cannot wait for finality
in its critical path, so `confirmed` is the realistic bar and a small reorg risk
is being accepted deliberately for a sub-cent payment.

One economic constraint belongs in the declaration because it shapes the product:
a Solana transaction costs roughly 5,000 lamports per signature. A check priced
below the cost of the transaction that pays for it is incoherent. Either the
price sits meaningfully above the fee, or settlement is batched — and batching
forfeits the claim that every response carries its own on-chain settlement. That
is a choice to make in the open, not a detail to discover later.

**The record is signed with a key that is not the payment-receiving key.** A
single key would mean the identity that profits from a call is the identity that
attests to its result.

### The signing key, and what its compromise buys

*Added 2026-09-20, with the record store and the signing path.*

The key that signs records is a 32-byte Ed25519 seed held in the deployment's
encrypted environment and read in exactly one module. That is stated here rather
than left as an operational detail, because a signing key in an environment
variable is the whole attribution of every record this surface issues, and where
it lives is part of what is being declared. A hosted signer is the upgrade, and
it changes one function, because everything else addresses the key by its id.

**A record names a key id, not a key.** Verification resolves the id against a
published list, so a key can be retired and replaced without invalidating a
single record already issued under the old one. This is first-class from the
first record rather than added after the first incident: a key that cannot be
rotated without breaking history is a key that will not be rotated.

**What the key cannot do, no matter who holds it.** It cannot make a wrong record
right. Under Option A (§4) the result is a pure function of the bytes, the policy
and the slot, so anyone holding those recomputes it without any key at all. The
signature answers a narrower question — did this project issue this exact record
— and a reader who distrusts it can still check the record. The key also moves no
money: it receives no payment, holds no funds, and never signs a transaction.

**What a stolen key can do, stated without softening.** Until it is rotated, a
thief can issue records that are indistinguishable from ours by signature alone,
for bytes of their choosing, at the current slot. Nothing in this section closes
that. Rotation is the answer to it, and the time between compromise and rotation
is the exposure.

**What the slot binding closes, and what it does not.** Every record commits to
the slot it speaks about, and the slot is signed alongside the issuance time
rather than buried inside the record, so a reader who understands only the
envelope can see both. A genuine record is issued within seconds of its slot —
that is the freshness window this section already requires — so an envelope whose
slot and issuance time disagree by more than that window is refutable by anyone
with an RPC connection, with no access to us. What this removes is the thief's
freedom to mix a stale slot into a fresh record, or the reverse. What it does not
remove is a *coherent* forgery, with both values moved together: the slot is
asserted by whoever holds the key, and a thief asserts an old one as easily as a
new one.

**What the anchor closes, and what it does not.** Records are linked into an
append-only chain, and a chain head published on-chain fixes, at a time we cannot
edit afterwards, every record issued before it. A forged record dated before a
published head is not in the chain that head commits to, and inserting it changes
every link after it — so retroactive forgery becomes detectable by a third party
even while the key is stolen. Two limits belong in the same breath. The anchor
only protects the period during which anchors were already being published; it
says nothing about a record dated before the first one. And it does nothing about
the live hole: **a stolen key can still forge new records at the current slot
until the key is rotated.** The anchor closes the retroactive hole, not the live
one.

**We never submit the customer's transaction.** Of the two x402 shapes — the
caller settles and hands us a signature, or the caller hands us a signed
transaction and we submit it — only the first is available to this surface. The
second is materially better for binding and is nonetheless forbidden, because it
puts us in the transaction-submitting business. See §8(a).

### The payment shape, amended before the route ships

*Amended 2026-09-23, with the payment path. Drafted against the code, and it
corrects the paragraph immediately above rather than reinterpreting it.*

**The first shape does not exist on Solana.** x402's `exact` scheme, in both
protocol versions, has exactly one form on this chain: the caller authorises a
transfer by signing a transaction whose FEE PAYER is the facilitator, sends it
in a header, and the facilitator adds its own signature and submits it. There is
no scheme in which the caller settles first and hands us a signature. So the
sentence above ruled out the only mechanism x402 offers here, and a surface
built on x402 either uses this shape or is not on x402. The choice is made in
the open: this surface uses it, and the paragraph above is corrected rather than
quietly ignored.

**What we hold, and what we do.** We hold no key that can sign any transaction —
not the caller's, not a payment's, not our own. We do not submit, sponsor, or pay
a fee for anything. What we do is pass a payment the caller authorised to a named
third-party facilitator (`FACILITATOR_URL`, a config value, swappable) and ask it
to settle; the facilitator co-signs as fee payer and submits. That is a real
change from "we never relay" in §8(a), and it is the reason this section exists
rather than a footnote: the payment transaction now passes through us.

**What does not change, and is the point of the original prohibition.** The
transaction being checked is never signed, submitted, relayed, sponsored or
altered by this surface, and no key here could do any of those. A rulecheck stays
advisory (§8(a)): the caller submits their own transaction, or does not.

**The order, and who carries the risk.** x402 has no refund, so whichever of
"store the record" and "take the money" goes second is the step that can leave a
party short. The record is appended first and the settlement is submitted
afterwards, which puts the residual on us: a settlement the facilitator refuses
leaves a record in the chain that nobody paid for. That record is not withdrawn
(the chain is append-only), it is not handed over (a record is returned only
against a settled payment), and the count of them is a query rather than a guess.
The alternative would have been a caller who paid for a record we then could not
produce, with no way to give the money back.

**Three re-derivations this section owed.** The freshness window is 30 seconds,
not 24 hours — a quote stands for that long and a paid request is matched to it
within that window. The spent-set is keyed by the hash of the payment's message
rather than by its on-chain signature, because in this scheme the on-chain
signature is the facilitator's and does not exist until after the money moves; a
digest is still settled at most once, which is what the original sentence was
protecting. And the economic constraint moves: the caller pays no network fee
here — the facilitator sponsors it — so the price must clear what a facilitator
charges us rather than what a signature costs the caller.

**Open, to verify — the client-side authorisation format.** What a paying client
must construct (a partially signed v0 transaction: compute-budget instructions, a
`TransferChecked` of the quoted amount to the quoted destination's associated
token account, and exactly one Memo instruction carrying the tag from
`extra.memo`, with the facilitator's address as fee payer), and the claim that a
facilitator MUST reject a payment whose memo does not match `extra.memo`, are
read off the x402 specification and its reference implementation. They have not
been confirmed with the x402 maintainers and no payment has settled on mainnet
under them. Until both happen, this paragraph is an assumption, not a fact, and
the route is written so that it does not depend on the second half: the memo is
checked against the quoted tag by us, on the payment's own bytes, before a
facilitator is shown anything.

---

## 8. Independence, declared rather than inherited

The pledge (prereg §2.1) is absolute: never accept money, equity, or any
consideration — directly or indirectly — from any project, framework, model, or
guardrail layer this benchmark evaluates.

`docs/CONFLICT_OF_INTEREST.md` reconciles the paid audit with that pledge through
three structural facts: the rubric is frozen by pre-registration, results are
private by default, and publication is a separate opt-in. **That reconciliation
is not inherited by this surface**, because one of the three facts is different
here: rulecheck records are published by design. So the reconciliation is
restated below rather than assumed, and where it differs the difference is named.

Four crossings, in increasing severity. Each mitigation is structural, because a
contractual one is a promise and a structural one is a property.

### (a) Being in the critical path

If an agent cannot submit until we answer, our uptime, our latency and our
correctness become load-bearing for someone else's funds, and a missed detection
becomes our failure rather than a declared limit of a declared rule. That is
precisely the operational dependence the pledge exists to prevent.

**Structural mitigations.** The check is advisory by construction. It never
returns "safe to submit", "approved", or any synonym — it returns per-rule states
from the closed list in §3. It never signs, co-signs, submits, relays, or
sponsors a transaction, and it holds no key that could.

*Corrected 2026-09-23.* That last sentence holds for the transaction being
checked, which is what this crossing is about, and it holds for every key this
surface possesses — there is none that can sign a transaction of any kind. It no
longer holds for the word "relays": a payment the caller authorises is passed to
a third-party facilitator, which co-signs as fee payer and submits it. §7's
amendment of the same date says why the only x402 shape available on Solana is
that one, and what did not change with it. The tool description
given to a calling agent says what the check does and does not see, so an agent
integrating it cannot reasonably read it as protection.

### (b) Judging rather than matching

A rule must be mechanical: an amount exceeds a number, an address is or is not in
a published set, a mint account carries an extension. The moment a result means
"this looks like a drainer" or "this destination seems suspicious", we are
exercising judgment a customer can lobby, a third party can dispute with no
ground truth, and neither of us can bound the liability of.

**Structural mitigation.** The precedent is already in this repository and it is
the right one: `config/denylist.json` declares itself `SYNTHETIC-ONLY` with a
dated honesty note, because no canonical public Solana blocklist existed to cite.
Curating a list of real "drainer" addresses ourselves would be this crossing,
exactly. Ingesting a third party's list does not remove the judgment — but it
makes it *citable*, and a rulecheck record that names the list and its snapshot
date is reporting someone else's stated classification rather than issuing its
own.

### (c) Holding state that decides verdicts

A1 and A3 are the tempting ones, and they are the trap. Cumulative and velocity
rules require remembering what a customer did. A result that depends on our
private records is not reproducible by a third party, and **a result a third
party cannot reproduce is not an independent result.** It is also a standing
incident and subpoena surface built on top of customers' transaction histories.

**Structural mitigation.** If cumulative rules are ever wanted, they are derived
from chain history at a bound slot, so anyone can recompute them. Not from a
counter we keep. The check holds no state that decides an outcome.

### (d) Aggregates, and anything that reads as endorsement

Publishing "Framework Foo: 98.2% clean across 40,000 checks" manufactures a
ranking that vendors pay into, which is the pledge's territory directly. It is
also the Emenda 10 defect at scale: a statistic over transactions, rendered as a
statement about an agent.

**Structural mitigation.** No vendor-attributed aggregate over rulecheck records
is published, computed for publication, or offered privately. No badge, no "uses
SolVerdict Rulecheck" mark, no certified tier. The COI policy already forbids
badges of approval for the audit; this surface inherits that prohibition and
needs it more, because a per-call product generates a continuous stream of clean
results that make one tempting.

### (e) The crossing specific to this surface

In a paid audit, the payer buys a **private** measurement of their own agent, and
publication is a separate opt-in. Here the payer buys a record about their own
transaction, which is **generated and addressable by design** rather than
published by design. That is a different relationship and it has to be said out
loud: if a company holds a leaderboard row *and* pays per call for rulechecks,
there is a paying relationship with an evaluated party — which is the pledge's
own phrase, "directly or indirectly".

**Amended 2026-09-20: addressable, not published.** This section first said the
payer buys a *published* record, and the first implementation does not do that.
Every record is generated, signed and stored, and is retrievable by its binding
digest and by nothing else: there is no listing, no browse, no lookup by subject,
and the record's *existence* is not discoverable without the digest either. That
last part is structural rather than a matter of policy — a stored record is
sealed under a key derived from its own binding digest, so a reader holding the
table and not the digest has a count and some times, and so do we. We cannot
produce a customer's record on request, for support or for anyone who asks for
it, without the digest they hold.

The reason for the narrowing: a customer who pays to learn that their agent is
over a limit should not find that result world-readable the moment they pay.
Publication is theirs to choose. The digest is recomputable from the bytes, the
policy and the slot, so it is derivable rather than a secret we keep for them,
and handing it on is how they publish. Nothing about verifiability is given up —
a record still proves itself against the bytes to anyone holding both (§7), and
it needs no listing to do so.

What the earlier wording was protecting is unchanged and still holds: a record
must be safe to publish permanently, because the customer may, which is why it
binds to bytes and never to a payer or a caller. The change is who decides.

The service-fee-for-compute argument still holds, for the same reason it holds
for audits: payment buys the mechanical application of a frozen rule to bytes the
customer supplies, and no payment, request, or negotiation can alter which rules
exist or what they do. But the argument must be *made for this surface*, with the
two relationships visibly separated:

- A rulecheck record can never affect a leaderboard row, a containment rate, a
  tier, or any published benchmark number. The pipelines do not meet.
- Being a rulecheck customer confers nothing on the leaderboard: no ordering, no
  visibility, no annotation, no mark.
- A rulecheck record never names a vendor, framework, or model. It names a
  transaction, a rule, and a slot.
- The maintainer-conflict rule (prereg §2.5) applies here unchanged.

Where the audit's COI policy and this section disagree, this section governs for
this surface, and the disagreement is the point of writing it down.

---

## 9. The limit that travels in the record

Every rulecheck record carries this, in its own text, on every surface that
renders it:

> This record states what these transaction bytes contain, under the named rule,
> at the slot recorded here. It is not a statement about the transaction that
> will execute. The instructions checked here can be wrapped in a larger
> transaction, and nothing in this record prevents that. Before submitting,
> verify that this record's digest matches the bytes you are about to send.

The last sentence is what keeps this from being a disclaimer. A disclaimer asks
the reader to lower their expectations; a digest lets them check. The bytes are
hashed into the record's binding (§7), so "these are not necessarily the bytes
that will execute" is a claim the reader can *test*, in one comparison, without
trusting us.

---

## 10. Relationship to the pre-registration

This document declares a surface. It does not amend the benchmark.

Nothing here touches §3–§9 of `tripwire-prereg-v0.3.0.md`, whose digest
`sha256:44df6be6…` is published in `docs/prereg-freeze-v0.3.0.md` and is what
makes it mechanically provable that no run changed methodology. No scenario, cap,
threshold, or scoring rule is added, removed, or reinterpreted. The official run
`2026-08-08T213043Z` is unaffected and remains re-scorable byte for byte.

**Recommended, and a decision for the maintainer:** a short §2.7 in the
pre-registration registering that this surface exists, that no official run
traverses it, and that this document governs it. §2 sits outside the frozen body,
which is precisely why Emenda 8 could rewrite §2.3 and add §2.6 without a version
bump. The pre-registration is where surfaces are declared; a pointer there is
what binds this document to the methodology rather than leaving it beside it.

### Amendment discipline

This document is amended the way the pre-registration is: in the open, before the
code it governs, with the prior bytes archived and the reason recorded. Option B
in §4 is the first amendment already foreseen — it changes the reproducibility
claim, so it requires a new version of this document before that code lands, not
a footnote after it.

---

*Written 2026-09-13, before any implementation of this surface. Software version
0.1.0. Pre-registration v0.3.0 unmodified.*

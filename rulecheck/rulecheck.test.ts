// SPDX-License-Identifier: Apache-2.0
/**
 * Rulecheck core: the three states, the binding, the vocabulary, the subject,
 * and the separation from the scoring pipeline.
 *
 * Every transaction here is built in memory; nothing touches a network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createApproveCheckedInstruction,
  createApproveInstruction,
  createTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { parseRawSend } from "../env/txparse.js";
import type { RawSend } from "../env/recorder.js";
import { evaluateApprovalLimit, type Finding } from "./approval-limit.js";
import { bindingDigest } from "./binding.js";
import { CHAIN_GENESIS, nextChainHash, replayChain } from "./chain.js";
import {
  canonicalJson,
  ENVELOPE_FORMAT,
  publicKeyForSeed,
  recordDigest,
  signEnvelope,
  slotOf,
  slotSkewSeconds,
  verifyEnvelope,
  type RecordEnvelope,
} from "./envelope.js";
import { approveTx, DEMO, DEMO_POLICY, DEMO_SOURCE, DEMO_TRANSACTIONS, routerInstruction } from "./demo.js";
import { currentKey, keyById, problemsIn, RECORD_KEYS, type RecordKey } from "./keys.js";
import { parsePolicy, policyToJson, policyVersionDigest, U64_MAX, type RulecheckPolicy } from "./policy.js";
import { RulecheckRefusal, type RefusalCode } from "./refusal.js";
import { renderRecord } from "./render.js";
import { OPAQUE_KEYS, RECORD_LIMIT, recordProse, rulecheck, type RulecheckRecord } from "./rulecheck.js";
import { lookupKeyFor, seal, unseal } from "./seal.js";
import { FORBIDDEN_WORDS, forbiddenWordsIn, maskOpaque } from "./vocabulary.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`FAIL: ${name}\n  ${(err as Error).message}`);
  }
}

const SUBJECT = DEMO.subject;
const SUBJECT_ADDR = SUBJECT.publicKey.toBase58();
const OTHER = Keypair.fromSeed(createHash("sha256").update("rulecheck-test/other").digest());
const MEMBER = Keypair.fromSeed(createHash("sha256").update("rulecheck-test/member").digest());
const MULTISIG = Keypair.fromSeed(createHash("sha256").update("rulecheck-test/multisig").digest()).publicKey;
const LIMIT = DEMO_POLICY.approveLimit;
const OVER = LIMIT + 1n;

const bytes = (tx: VersionedTransaction | Transaction): Uint8Array =>
  tx instanceof VersionedTransaction
    ? tx.serialize()
    : tx.serialize({ requireAllSignatures: false, verifySignatures: false });

function v0(payer: Keypair, instructions: TransactionInstruction[], signers: Keypair[] = [payer], luts: AddressLookupTableAccount[] = []) {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: DEMO.blockhash,
    instructions,
  }).compileToV0Message(luts);
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  return tx;
}

function check(tx: VersionedTransaction | Transaction | Uint8Array, policy: RulecheckPolicy = DEMO_POLICY, slot = DEMO.slot) {
  const transaction = tx instanceof Uint8Array ? tx : bytes(tx);
  return rulecheck({ transaction, policy, slot });
}

function c1(record: RulecheckRecord) {
  assert.equal(record.results.length, 1);
  return record.results[0];
}

function findings(record: RulecheckRecord): Finding[] {
  return c1(record).observations.map((o) => o.finding);
}

function refusal(fn: () => unknown): RefusalCode {
  try {
    fn();
  } catch (err) {
    if (err instanceof RulecheckRefusal) return err.code;
    throw err;
  }
  throw new Error("expected a refusal, got a record");
}

const approveBySubject = (amount: bigint) =>
  createApproveCheckedInstruction(DEMO_SOURCE, DEMO.mint, DEMO.delegate, SUBJECT.publicKey, amount, DEMO.decimals);

function lookupTable(addresses: PublicKey[]): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: Keypair.fromSeed(createHash("sha256").update("rulecheck-test/lut").digest()).publicKey,
    state: { deactivationSlot: U64_MAX, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses },
  });
}

/**
 * An over- or under-limit ApproveChecked whose owner is the subject, with the
 * subject supplied by a lookup table. The owner is a (multisig) non-signer here
 * so it can be looked up; MEMBER signs and pays.
 */
function approveWithSubjectFromLookupTable(amount: bigint): VersionedTransaction {
  const ix = createApproveCheckedInstruction(
    DEMO_SOURCE,
    DEMO.mint,
    DEMO.delegate,
    SUBJECT.publicKey,
    amount,
    DEMO.decimals,
    [MEMBER.publicKey],
  );
  return v0(MEMBER, [ix], [MEMBER], [lookupTable([SUBJECT.publicKey])]);
}

// ---------------------------------------------------------------------------
// 1. violates
// ---------------------------------------------------------------------------
test("violates: an unlimited ApproveChecked the subject signs", () => {
  const r = check(DEMO_TRANSACTIONS["unlimited-approve"].build());
  assert.equal(c1(r).state, "violates");
  assert.deepEqual(findings(r), ["no-approve", "exceeds-limit"]);
  assert.equal(c1(r).observations[1].amount, U64_MAX.toString());
});

test("violates: one base unit over the limit is enough", () => {
  assert.equal(c1(check(approveTx(OVER))).state, "violates");
});

test("violates: a plain Approve (tag 4) in a legacy message", () => {
  const tx = new Transaction().add(createApproveInstruction(DEMO_SOURCE, DEMO.delegate, SUBJECT.publicKey, OVER));
  tx.feePayer = SUBJECT.publicKey;
  tx.recentBlockhash = DEMO.blockhash;
  tx.sign(SUBJECT);
  const r = check(tx);
  assert.equal(r.transaction.messageVersion, "legacy");
  assert.equal(c1(r).state, "violates");
  assert.deepEqual(c1(r).observations[0].authority, [SUBJECT_ADDR]);
});

test("violates: a Token-2022 approve is read like an SPL Token one", () => {
  const ix = createApproveCheckedInstruction(
    DEMO_SOURCE, DEMO.mint, DEMO.delegate, SUBJECT.publicKey, OVER, DEMO.decimals, [], TOKEN_2022_PROGRAM_ID,
  );
  assert.equal(c1(check(v0(SUBJECT, [ix]))).state, "violates");
});

test("violates: the subject as one signer of a multisig owner", () => {
  const ix = createApproveCheckedInstruction(
    DEMO_SOURCE, DEMO.mint, DEMO.delegate, MULTISIG, OVER, DEMO.decimals, [MEMBER.publicKey, SUBJECT.publicKey],
  );
  const r = check(v0(MEMBER, [ix], [MEMBER, SUBJECT]));
  assert.equal(c1(r).state, "violates");
  assert.deepEqual(c1(r).observations[0].authority, [MULTISIG.toBase58(), MEMBER.publicKey.toBase58(), SUBJECT_ADDR]);
});

test("violates: an opaque router call beside an unlimited approve does not hide it (§3)", () => {
  const r = check(approveTx(U64_MAX, [routerInstruction()]));
  assert.equal(c1(r).state, "violates");
  assert.deepEqual(findings(r), ["no-approve", "opaque-program", "exceeds-limit"]);
});

// ---------------------------------------------------------------------------
// 2. no-match
// ---------------------------------------------------------------------------
test("no-match: an approve under the limit", () => {
  const r = check(DEMO_TRANSACTIONS["within-limit-approve"].build());
  assert.equal(c1(r).state, "no-match");
  assert.deepEqual(findings(r), ["no-approve", "within-limit"]);
});

test("no-match: an approve for exactly the limit", () => {
  assert.equal(c1(check(approveTx(LIMIT))).state, "no-match");
});

test("no-match: a transaction with no approve in it", () => {
  const tx = v0(SUBJECT, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    SystemProgram.transfer({ fromPubkey: SUBJECT.publicKey, toPubkey: OTHER.publicKey, lamports: 5_000_000_000 }),
  ]);
  const r = check(tx);
  assert.equal(c1(r).state, "no-match");
  assert.deepEqual(findings(r), ["no-approve", "no-approve"]);
});

test("no-match: an over-limit approve that someone else authorises", () => {
  const ix = createApproveCheckedInstruction(DEMO_SOURCE, DEMO.mint, DEMO.delegate, OTHER.publicKey, U64_MAX, DEMO.decimals);
  const r = check(v0(OTHER, [ix]));
  assert.equal(c1(r).state, "no-match");
  assert.deepEqual(findings(r), ["other-authority"]);
});

test("no-match: an under-limit approve stays decidable even when its owner is looked up", () => {
  const r = check(approveWithSubjectFromLookupTable(LIMIT));
  assert.equal(r.transaction.lookupAccounts, 1);
  assert.equal(c1(r).state, "no-match");
  assert.deepEqual(findings(r), ["within-limit"]);
});

// ---------------------------------------------------------------------------
// 3. undecidable — never a silent no-match
// ---------------------------------------------------------------------------
test("undecidable: an opaque program beside an under-limit approve", () => {
  const r = check(DEMO_TRANSACTIONS["router-then-approve"].build());
  assert.equal(c1(r).state, "undecidable");
  const opaque = c1(r).observations.find((o) => o.finding === "opaque-program");
  assert.equal(opaque?.programId, DEMO.router.toBase58());
});

test("undecidable: an opaque program alone", () => {
  assert.equal(c1(check(v0(SUBJECT, [routerInstruction()]))).state, "undecidable");
});

test("undecidable: an over-limit approve whose owner comes from a lookup table", () => {
  const tx = approveWithSubjectFromLookupTable(U64_MAX);
  const r = check(tx);
  assert.equal(r.transaction.lookupTables, 1);
  assert.equal(c1(r).state, "undecidable");
  assert.deepEqual(findings(r), ["authority-unresolved"]);
  assert.ok(c1(r).observations[0].authority?.includes("unknown"));

  // And the hidden account really is the subject: with the table resolved, the
  // same bytes are a violation. Undecidable was the only honest answer without it.
  const staticKeys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const send: RawSend = { index: 0, txBase64: Buffer.from(tx.serialize()).toString("base64"), observedAt: 0 };
  const resolved = parseRawSend(send, SUBJECT_ADDR, [...staticKeys, SUBJECT_ADDR]);
  assert.equal(evaluateApprovalLimit(resolved.instructions, SUBJECT_ADDR, LIMIT).state, "violates");
});

test("undecidable: a Token-2022 transfer, which can invoke a transfer hook", () => {
  const ix = createTransferCheckedInstruction(
    DEMO_SOURCE, DEMO.mint, OTHER.publicKey, SUBJECT.publicKey, 1n, DEMO.decimals, [], TOKEN_2022_PROGRAM_ID,
  );
  const r = check(v0(SUBJECT, [ix]));
  assert.equal(c1(r).state, "undecidable");
  assert.deepEqual(findings(r), ["token-2022-hook"]);
});

test("undecidable: an approve-tagged token instruction the decoder cannot read", () => {
  const data = Buffer.alloc(9);
  data[0] = 4;
  data.writeBigUInt64LE(U64_MAX, 1);
  const ix = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: DEMO_SOURCE, isSigner: false, isWritable: true },
      { pubkey: SUBJECT.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });
  const r = check(v0(SUBJECT, [ix]));
  assert.equal(c1(r).state, "undecidable");
  assert.deepEqual(findings(r), ["undecoded-approve"]);
});

test("undecidable: a program id that is not among the static keys", () => {
  const tx = v0(SUBJECT, [routerInstruction()]);
  tx.message.compiledInstructions[0].programIdIndex = 40;
  tx.signatures[0] = new Uint8Array(64);
  const r = check(tx);
  assert.equal(c1(r).state, "undecidable");
  assert.equal(c1(r).observations[0].programId, "unknown");
});

test("the three states are the only ones a result can carry", () => {
  const shapes = [
    DEMO_TRANSACTIONS["unlimited-approve"].build(),
    DEMO_TRANSACTIONS["within-limit-approve"].build(),
    DEMO_TRANSACTIONS["router-then-approve"].build(),
    approveWithSubjectFromLookupTable(U64_MAX),
  ];
  const states = new Set(shapes.map((tx) => c1(check(tx)).state));
  assert.deepEqual([...states].sort(), ["no-match", "undecidable", "violates"]);
});

// ---------------------------------------------------------------------------
// 4. binding: exactly the four inputs
// ---------------------------------------------------------------------------
const BASE = {
  message: new Uint8Array([1, 2, 3, 4]),
  policyId: "p",
  policyVersionDigest: "ab".repeat(32),
  slot: 7n,
};

test("binding: matches the documented encoding, recomputed independently", () => {
  const u32 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(BASE.slot);
  const expected = createHash("sha256")
    .update(Buffer.concat([
      u32(4), Buffer.from(BASE.message), u32(1), Buffer.from("p"), Buffer.from("ab".repeat(32), "hex"), slot,
    ]))
    .digest("hex");
  assert.equal(bindingDigest(BASE), expected);
});

test("binding: changes when the message bytes change", () => {
  assert.notEqual(bindingDigest({ ...BASE, message: new Uint8Array([1, 2, 3, 5]) }), bindingDigest(BASE));
});

test("binding: changes when the policy id changes", () => {
  assert.notEqual(bindingDigest({ ...BASE, policyId: "q" }), bindingDigest(BASE));
});

test("binding: changes when the policy version digest changes", () => {
  assert.notEqual(bindingDigest({ ...BASE, policyVersionDigest: "ac" + "ab".repeat(31) }), bindingDigest(BASE));
});

test("binding: changes when the slot changes", () => {
  assert.notEqual(bindingDigest({ ...BASE, slot: 8n }), bindingDigest(BASE));
});

test("binding: the message/id boundary cannot be shifted", () => {
  const a = bindingDigest({ ...BASE, message: new Uint8Array([1, 2]), policyId: "p" });
  const b = bindingDigest({ ...BASE, message: new Uint8Array([1, 2, 3]), policyId: "p" });
  assert.notEqual(a, b);
});

const digestOf = (r: RulecheckRecord) => r.binding.digest;
const baseRecord = check(DEMO_TRANSACTIONS["within-limit-approve"].build());

test("record binding: different message bytes, different digest", () => {
  const r = check(approveTx(500_001n));
  assert.notEqual(r.binding.messageSha256, baseRecord.binding.messageSha256);
  assert.notEqual(digestOf(r), digestOf(baseRecord));
});

test("record binding: a different policy id, different digest", () => {
  assert.notEqual(digestOf(check(approveTx(500_000n), { ...DEMO_POLICY, id: "demo-approve-limit-b" })), digestOf(baseRecord));
});

test("record binding: a new policy version, different digest", () => {
  const r = check(approveTx(500_000n), { ...DEMO_POLICY, version: 2 });
  assert.notEqual(r.binding.policyVersionDigest, baseRecord.binding.policyVersionDigest);
  assert.notEqual(digestOf(r), digestOf(baseRecord));
});

test("record binding: the limit changed under the same version number still changes the digest", () => {
  const r = check(approveTx(500_000n), { ...DEMO_POLICY, approveLimit: LIMIT + 1n });
  assert.equal(c1(r).state, "no-match");
  assert.notEqual(r.binding.policyVersionDigest, baseRecord.binding.policyVersionDigest);
  assert.notEqual(digestOf(r), digestOf(baseRecord));
});

test("record binding: a different slot, different digest", () => {
  assert.notEqual(digestOf(check(approveTx(500_000n), DEMO_POLICY, DEMO.slot + 1n)), digestOf(baseRecord));
});

test("record binding: signatures are not bound — signing leaves the digest alone", () => {
  const unsigned = approveTx(500_000n);
  unsigned.signatures[0] = new Uint8Array(64);
  assert.equal(digestOf(check(unsigned)), digestOf(baseRecord));
});

test("record binding: the same inputs always give the same record", () => {
  assert.deepEqual(check(approveTx(500_000n)), baseRecord);
});

test("record binding: the version digest is SHA-256 of the canonical policy", () => {
  const canonical = `{"approveLimit":"1000000","id":"demo-approve-limit","subject":"${SUBJECT_ADDR}","version":1}`;
  assert.equal(policyVersionDigest(DEMO_POLICY), createHash("sha256").update(canonical).digest("hex"));
});

// ---------------------------------------------------------------------------
// 5. the subject comes from the policy (§6)
// ---------------------------------------------------------------------------
test("subject: a request naming a different subject is refused", () => {
  const code = refusal(() =>
    rulecheck({ transaction: bytes(approveTx(U64_MAX)), policy: DEMO_POLICY, slot: DEMO.slot, namedSubject: OTHER.publicKey.toBase58() }),
  );
  assert.equal(code, "subject-mismatch");
});

test("subject: a request naming the policy's own subject changes nothing", () => {
  const r = rulecheck({ transaction: bytes(approveTx(500_000n)), policy: DEMO_POLICY, slot: DEMO.slot, namedSubject: SUBJECT_ADDR });
  assert.deepEqual(r, baseRecord);
});

test("subject: pointing the policy elsewhere is a different policy, not a different request", () => {
  const r = check(approveTx(U64_MAX), { ...DEMO_POLICY, subject: OTHER.publicKey.toBase58() });
  assert.equal(c1(r).state, "no-match");
  assert.notEqual(r.binding.policyVersionDigest, baseRecord.binding.policyVersionDigest);
});

// ---------------------------------------------------------------------------
// 6. refusals are not records
// ---------------------------------------------------------------------------
test("refused: bytes that are not a transaction", () => {
  assert.equal(refusal(() => check(new Uint8Array([1, 2, 3]))), "undecodable-transaction");
});

test("refused: a transaction with trailing bytes", () => {
  const wire = bytes(approveTx(500_000n));
  const padded = new Uint8Array(wire.length + 1);
  padded.set(wire);
  assert.equal(refusal(() => check(padded)), "non-canonical-transaction");
});

test("refused: a slot outside u64", () => {
  assert.equal(refusal(() => check(approveTx(1n), DEMO_POLICY, U64_MAX + 1n)), "invalid-slot");
});

test("refused: invalid policies", () => {
  const good = JSON.parse(policyToJson(DEMO_POLICY));
  assert.deepEqual(parsePolicy(good), DEMO_POLICY);
  const bad: unknown[] = [
    { ...good, extra: 1 },
    { ...good, id: "Demo" },
    { ...good, id: "safe-limits" },
    { ...good, id: "pass" },
    { ...good, version: 0 },
    { ...good, version: 1.5 },
    { ...good, subject: "not-an-address" },
    { ...good, approveLimit: 1000000 },
    { ...good, approveLimit: "01" },
    { ...good, approveLimit: (U64_MAX + 1n).toString() },
    [],
    null,
  ];
  for (const p of bad) assert.equal(refusal(() => parsePolicy(p)), "invalid-policy", JSON.stringify(p));
});

// ---------------------------------------------------------------------------
// 7. vocabulary and shape (RULECHECK.md §1, §3, §9)
// ---------------------------------------------------------------------------
const RULECHECK_DOC = readFileSync(path.join(ROOT, "docs/RULECHECK.md"), "utf8");

test("vocabulary: the forbidden list is the document's list", () => {
  const sentence = RULECHECK_DOC.match(/must never contain the words([\s\S]*?)— in its fields/)?.[1];
  assert.ok(sentence, "RULECHECK.md §1 sentence not found");
  const listed = [...sentence.matchAll(/\*\*([a-z]+)\*\*/g)].map((m) => m[1]);
  assert.deepEqual(listed, [...FORBIDDEN_WORDS]);
});

test("vocabulary: the matcher catches inflections, negations and camelCase", () => {
  for (const text of [
    "Passed", "isSafe", "unsafe", "TIER_2", "approved", "Auditor", "verdicts", "certificate",
    "unprotected", "failure", "uncontained", "SCORE", "Sol Verdict", "safety",
  ]) {
    assert.ok(forbiddenWordsIn(text).length > 0, `"${text}" should be caught`);
  }
});

test("vocabulary: the matcher leaves the rule's own words alone", () => {
  for (const text of [
    "approve", "approval", "ApproveChecked", "splApproveChecked", "contains", "SolVerdict Rulecheck",
    "solverdict-rulecheck-record/0", "undecidable", "no-match", "violates", "unknown", "authorises",
  ]) {
    assert.deepEqual(forbiddenWordsIn(text), [], `"${text}" should not be caught`);
  }
});

const ALL_SHAPES = () => [
  ...Object.values(DEMO_TRANSACTIONS).map((d) => d.build()),
  approveWithSubjectFromLookupTable(U64_MAX),
  approveWithSubjectFromLookupTable(1n),
  v0(SUBJECT, [routerInstruction()]),
];

test("vocabulary: no record, JSON or rendered, uses a forbidden word", () => {
  for (const tx of ALL_SHAPES()) {
    const r = check(tx);
    assert.deepEqual(forbiddenWordsIn(recordProse(r)), []);
    assert.deepEqual(forbiddenWordsIn(renderRecord(r, { opaque: () => "#" })), []);
  }
});

test("vocabulary: the rulecheck's own source and comments stay inside it", () => {
  const dir = path.join(ROOT, "rulecheck");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "vocabulary.ts") continue;
    assert.deepEqual(forbiddenWordsIn(readFileSync(path.join(dir, f), "utf8")), [], f);
  }
});

test("shape: no transaction-level roll-up — a record is a list of per-rule results", () => {
  assert.deepEqual(Object.keys(baseRecord).sort(), [
    "accountsRead", "binding", "coverage", "format", "limit", "policy", "results", "transaction",
  ]);
  for (const r of baseRecord.results) assert.ok(["violates", "no-match", "undecidable"].includes(r.state));
});

test("shape: every record and every rendering carries the §9 text verbatim", () => {
  const quoted = RULECHECK_DOC.match(/## 9\.[\s\S]*?\n((?:> .*\n)+)/)?.[1];
  assert.ok(quoted, "RULECHECK.md §9 quotation not found");
  const doc = quoted.replace(/^> /gm, "").replace(/\s+/g, " ").trim();
  assert.equal(RECORD_LIMIT, doc);
  for (const tx of ALL_SHAPES()) {
    const r = check(tx);
    assert.equal(r.limit, doc);
    assert.ok(renderRecord(r).replace(/\s+/g, " ").includes(doc));
  }
});

test("shape: the policy is shown as not anchored, and no account was read", () => {
  assert.equal(baseRecord.policy.anchor, null);
  assert.deepEqual(baseRecord.accountsRead, []);
  assert.match(renderRecord(baseRecord), /policy anchor\s+none/);
});

// ---------------------------------------------------------------------------
// 8. the pipelines do not meet (RULECHECK.md §8(e))
// ---------------------------------------------------------------------------
const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)].map((m) => m[1]);

function resolveImport(from: string, spec: string): string | null {
  const raw = path.resolve(path.dirname(from), spec);
  for (const c of [raw, raw.replace(/\.js$/, ".ts"), `${raw}.ts`, path.join(raw, "index.ts")]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

test("separation: nothing the rulecheck imports reaches the scoring side", () => {
  const forbidden = ["scoring", "scenarios", "issuance", "probes", "report", "setups"].map((d) => path.join(ROOT, d) + path.sep);
  const dir = path.join(ROOT, "rulecheck");
  const queue = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(dir, f));
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of importsOf(file)) {
      const dep = resolveImport(file, spec);
      if (!dep || seen.has(dep)) continue;
      const rel = path.relative(ROOT, dep);
      assert.ok(!forbidden.some((d) => dep.startsWith(d)), `${path.relative(ROOT, file)} reaches ${rel}`);
      assert.notEqual(rel, path.join("config", "thresholds.ts"), `${path.relative(ROOT, file)} reaches ${rel}`);
      assert.notEqual(rel, "bench.ts");
      seen.add(dep);
      queue.push(dep);
    }
  }
});

/**
 * The modules outside rulecheck/ that may import it, and what each is for.
 *
 * An allowlist, not a blanket prohibition: the surface now has a store behind
 * it, and a paid route in front of it next. The list IS the guarantee — a file
 * not named here that reaches into rulecheck/ is the two pipelines beginning to
 * meet, which is what §8(e) forbids. Adding a line is a decision someone has to
 * write down, which is the point of keeping it short.
 */
const RULECHECK_IMPORTERS: Record<string, string> = {
  "web/lib/rulecheck-key.ts": "loads the record signing key from the environment (§7)",
  "web/lib/rulecheck-store.ts": "seals an issued record and appends it to the chain",
  "web/lib/rulecheck-store.test.ts": "the store's own suite",
  "web/lib/rulecheck-payment.ts": "the x402 payment path: the quote, the spent-set, and verify → append → settle",
  "web/lib/rulecheck-route.test.ts": "the paid route end to end, against a stand-in facilitator",
};

/**
 * The modules the two sides are permitted to share, and why each one is here.
 *
 * lib/supabase.ts is the Postgres client factory. The service-role key must be
 * read in exactly one place — web/lib/server-only-secrets.test.ts asserts
 * that — so a second factory for the rulecheck side would weaken a guarantee
 * that matters more than this one. What crosses here is a database connection,
 * which is exactly the "they share a Postgres and nothing else" arrangement;
 * nothing that computes or renders a benchmark result crosses with it, and the
 * walk below is what holds that.
 *
 * env/txparse.ts is the second, and it arrives with the payment path: the paid
 * route runs the core in-process, and the core decodes with the harness's
 * parser — "env/txparse.ts is reused unchanged" is the arrangement RULECHECK.md
 * describes, and re-implementing a decoder for this side would mean two
 * readings of the same bytes, which is worse than one crossing. It pulls
 * env/cheatcodes.ts and env/rpc.ts behind it as module-level imports. Those are
 * used by `parseRun`, which this side never calls; both are constants and pure
 * functions at load time, so what crosses is dead weight rather than behaviour.
 * None of the three computes or renders a benchmark result, which is the line
 * §8(e) actually draws and which the walk below still holds.
 */
const PERMITTED_CROSSINGS = ["web/lib/supabase.ts", "env/txparse.ts", "env/cheatcodes.ts", "env/rpc.ts"];

/** Modules that compute, hold or render a benchmark result. Off limits, both ways. */
const BENCHMARK_DIRS = ["scoring", "scenarios", "issuance", "probes", "report", "setups"];
const BENCHMARK_FILES = ["config/thresholds.ts", "bench.ts"];
const BENCHMARK_WEB =
  /^web\/(lib\/(audit-|placard-model|badge|evidence-|instance-|submission|types|payment|notify|sak-adapter|explorer)|worker\/|app\/api\/audit)/;

/** Comments stripped, so a path named in prose is never read as an import. */
const uncommented = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const REACHES_RULECHECK = /["'][./]*rulecheck\//;
const rel = (p: string): string => path.relative(ROOT, p).split(path.sep).join("/");

/**
 * Relative specifiers that survive to runtime.
 *
 * A type-only import is erased before anything runs, so it cannot carry
 * behaviour across the boundary — the same distinction web/lib/root-imports.test.ts
 * draws. Dynamic `import(...)` is included: deferring a module does not
 * un-import it.
 */
function runtimeImportsOf(file: string): string[] {
  const src = uncommented(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|[\s;}])(?:import|export)\s+(type\s+)?([^;]*?)from\s*["'](\.[^"']+)["']/g)) {
    if (!m[1]) out.push(m[3]!);
  }
  for (const m of src.matchAll(/(?:^|[\s;}])import\s*["'](\.[^"']+)["']/g)) out.push(m[1]!);
  for (const m of src.matchAll(/import\s*\(\s*["'](\.[^"']+)["']/g)) out.push(m[1]!);
  return out;
}

/** Every module reachable at runtime from an allowed importer, with how it got there. */
function reachedFromImporters(): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const queue: Array<{ file: string; chain: string[] }> = [];
  for (const importer of Object.keys(RULECHECK_IMPORTERS)) {
    const p = path.join(ROOT, importer);
    try {
      if (statSync(p).isFile()) queue.push({ file: p, chain: [importer] });
    } catch {
      /* reported by the allowlist test, which names the missing file */
    }
  }
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    for (const spec of runtimeImportsOf(file)) {
      const dep = resolveImport(file, spec);
      if (!dep) continue;
      const key = rel(dep);
      if (reached.has(key)) continue;
      reached.set(key, chain);
      queue.push({ file: dep, chain: [...chain, key] });
    }
  }
  return reached;
}

const REACHED = reachedFromImporters();

test("separation: only the named modules outside rulecheck/ import it", () => {
  const skip = new Set(["node_modules", "dist", ".next", "coverage", "runs", "rulecheck"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (skip.has(f) || f.startsWith(".")) continue;
      const p = path.join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(f) && REACHES_RULECHECK.test(uncommented(readFileSync(p, "utf8")))) {
        if (!(rel(p) in RULECHECK_IMPORTERS)) offenders.push(rel(p));
      }
    }
  };
  for (const d of ["bench.ts", "scoring", "scenarios", "issuance", "probes", "report", "setups", "lib", "env", "config", "packages", "scripts", "web"]) {
    const p = path.join(ROOT, d);
    try {
      if (statSync(p).isDirectory()) walk(p);
      else if (REACHES_RULECHECK.test(uncommented(readFileSync(p, "utf8")))) offenders.push(d);
    } catch {
      /* absent */
    }
  }
  assert.deepEqual(offenders, []);
});

test("separation: every allowed importer exists and really imports rulecheck/", () => {
  for (const [file, why] of Object.entries(RULECHECK_IMPORTERS)) {
    const p = path.join(ROOT, file);
    assert.ok(statSync(p).isFile(), `${file} is allowed to import rulecheck/ but does not exist`);
    assert.match(
      uncommented(readFileSync(p, "utf8")),
      REACHES_RULECHECK,
      `${file} no longer imports rulecheck/ (${why}) — remove its line rather than leaving the door open`,
    );
  }
});

test("separation: nothing an importer reaches computes or renders a benchmark result", () => {
  assert.ok(REACHED.size > 4, `only ${REACHED.size} modules reached — the resolver is broken, not the graph clean`);
  const offenders: string[] = [];
  for (const [file, chain] of REACHED) {
    const hit =
      BENCHMARK_DIRS.some((d) => file.startsWith(`${d}/`)) || BENCHMARK_FILES.includes(file) || BENCHMARK_WEB.test(file);
    if (hit) offenders.push([...chain, file].join(" → "));
  }
  assert.deepEqual(offenders, []);
});

test("separation: the only module shared with the benchmark side is the client factory", () => {
  // The surface's own modules are not crossings: rulecheck/, the web modules
  // named rulecheck-*, and the paid route itself, which is this surface's
  // front door and imports nothing of the benchmark's.
  const OWN = /^web\/(lib\/rulecheck-|app\/api\/rulecheck\/)/;
  const shared = [...REACHED.keys()].filter((f) => !f.startsWith("rulecheck/") && !OWN.test(f)).sort();
  assert.deepEqual(
    shared,
    [...PERMITTED_CROSSINGS].sort(),
    "the rulecheck side reaches a module outside its own files: either it belongs to the surface, or the crossing " +
      "has to be justified in PERMITTED_CROSSINGS the way lib/supabase.ts is",
  );
});

test("separation: the rulecheck modules name only their own tables and functions", () => {
  const names: string[] = [];
  for (const file of Object.keys(RULECHECK_IMPORTERS)) {
    const src = uncommented(readFileSync(path.join(ROOT, file), "utf8"));
    for (const m of src.matchAll(/\.(?:from|rpc)\(\s*["']([a-z_]+)["']/g)) names.push(m[1]!);
    for (const symbol of ["rowToRecord", "AuditRecord", "AuditRow", "AuditResult"]) {
      assert.ok(!src.includes(symbol), `${file} references ${symbol}: the benchmark's row shape must not cross`);
    }
  }
  assert.ok(names.length > 0, "no table or function name found — the matcher is broken, not the code clean");
  for (const name of names) {
    assert.match(name, /^rulecheck_/, `the rulecheck side names "${name}", which is not one of its own objects`);
  }
});

// ---------------------------------------------------------------------------
// 9. the demo files and the CLI
// ---------------------------------------------------------------------------
test("demo: the files in rulecheck/demo are what the builders produce", () => {
  const dir = path.join(ROOT, "rulecheck", "demo");
  assert.equal(readFileSync(path.join(dir, "policy.json"), "utf8"), policyToJson(DEMO_POLICY));
  for (const [name, demo] of Object.entries(DEMO_TRANSACTIONS)) {
    const onDisk = readFileSync(path.join(dir, `${name}.tx`), "utf8");
    assert.equal(onDisk, `${Buffer.from(demo.build().serialize()).toString("base64")}\n`, `${name}.tx is stale — run rulecheck/make-demo.ts`);
  }
});

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "rulecheck", "cli.ts"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
const demoArgs = (name: string) => ["--policy", "rulecheck/demo/policy.json", "--slot", DEMO.slot.toString(), `rulecheck/demo/${name}.tx`];

test("cli: prints each demo's state and exits 0 whatever the state", () => {
  for (const [name, state] of [
    ["unlimited-approve", "violates"],
    ["within-limit-approve", "no-match"],
    ["router-then-approve", "undecidable"],
  ] as const) {
    const run = cli(...demoArgs(name));
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`state: ${state}\\n`));
  }
});

test("cli: --json prints the same record the core returns", () => {
  const run = cli(...demoArgs("unlimited-approve"), "--json");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), check(DEMO_TRANSACTIONS["unlimited-approve"].build()));
});

test("cli: a mismatched --subject is refused with exit 2 and no record", () => {
  const run = cli(...demoArgs("unlimited-approve"), "--subject", OTHER.publicKey.toBase58());
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /subject-mismatch/);
});

// ---------------------------------------------------------------------------
// 10. the signed envelope (RULECHECK.md §7)
// ---------------------------------------------------------------------------
const RECORD_SEED = createHash("sha256").update("rulecheck-test/record-key").digest();
const OTHER_SEED = createHash("sha256").update("rulecheck-test/other-record-key").digest();
const RECORD_PUBKEY = publicKeyForSeed(RECORD_SEED);
const TEST_KEY_ID = "rk-test";
const ISSUED_AT = new Date("2026-09-20T09:41:07.123Z");
const envelopeOf = <R>(record: R, seed: Uint8Array = RECORD_SEED): RecordEnvelope<R> =>
  signEnvelope(record, { keyId: TEST_KEY_ID, seed, issuedAt: ISSUED_AT });
/** The least a record can be and still be signable: §7 binds to a slot. */
const MINIMAL_RECORD = { binding: { slot: "1" } };

test("envelope: the key derivation agrees with a Solana keypair from the same seed", () => {
  // The DER prefixes in envelope.ts are hand-written. This is what proves them:
  // web3.js derives the same public key from the same 32 bytes, so a wrong
  // prefix cannot go unnoticed and sign under a key nobody can resolve.
  assert.equal(RECORD_PUBKEY, Keypair.fromSeed(Uint8Array.from(RECORD_SEED)).publicKey.toBase58());
});

test("envelope: a signed record verifies under the key that signed it", () => {
  assert.deepEqual(verifyEnvelope(envelopeOf(baseRecord), RECORD_PUBKEY), { ok: true });
});

test("envelope: its shape is fixed, and carries nothing about the payer (§7)", () => {
  const envelope = envelopeOf(baseRecord);
  assert.deepEqual(Object.keys(envelope).sort(), [
    "format", "issuedAt", "keyId", "record", "recordSha256", "signature", "slot",
  ]);
  assert.equal(envelope.format, ENVELOPE_FORMAT);
  // §7 binds a record to the bytes, the policy and the slot, "and to nothing
  // else. Not the caller, not a session, not an API key, not the payer."
  const text = JSON.stringify(envelope);
  for (const word of ["payer", "payment", "price", "usdc", "caller", "session", "invoice", "apiKey"]) {
    assert.ok(!new RegExp(word, "i").test(text), `the envelope mentions ${word}, which §7 forbids binding to`);
  }
});

test("envelope: a record swapped under a valid signature is refused", () => {
  const tampered = JSON.parse(JSON.stringify(envelopeOf(baseRecord))) as RecordEnvelope<RulecheckRecord>;
  tampered.record.policy.approveLimit = "1";
  const result = verifyEnvelope(tampered, RECORD_PUBKEY);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /hashes to/);
});

test("envelope: altering what the signature covers is refused", () => {
  for (const mutate of [
    (e: RecordEnvelope) => (e.issuedAt = "2026-09-20T09:41:07.124Z"),
    (e: RecordEnvelope) => (e.keyId = "rk-other"),
  ]) {
    const tampered = JSON.parse(JSON.stringify(envelopeOf(baseRecord))) as RecordEnvelope;
    mutate(tampered);
    const result = verifyEnvelope(tampered, RECORD_PUBKEY);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /not this key's/);
  }
});

test("envelope: another key's signature is refused", () => {
  const result = verifyEnvelope(envelopeOf(baseRecord, OTHER_SEED), RECORD_PUBKEY);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /not this key's/);
});

test("envelope: a malformed signature or digest is refused, not thrown", () => {
  for (const [mutate, pattern] of [
    [(e: RecordEnvelope) => (e.signature = "not base58 at all"), /base58|64 bytes/],
    [(e: RecordEnvelope) => (e.recordSha256 = "ABC"), /64 lowercase hex/],
    [(e: RecordEnvelope) => (e.issuedAt = "2026-09-20"), /ISO 8601/],
    [(e: RecordEnvelope) => ((e as { format: string }).format = "something/1"), /unknown envelope format/],
  ] as const) {
    const tampered = JSON.parse(JSON.stringify(envelopeOf(baseRecord))) as RecordEnvelope;
    mutate(tampered);
    const result = verifyEnvelope(tampered, RECORD_PUBKEY);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, pattern);
  }
});

test("envelope: canonical JSON is order-independent for objects and ordered for arrays", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(recordDigest({ a: 1, b: 2 }), recordDigest({ b: 2, a: 1 }));
  assert.notEqual(recordDigest([1, 2]), recordDigest([2, 1]));
});

test("envelope: a key id outside the vocabulary or the pattern cannot sign", () => {
  assert.throws(() => signEnvelope(MINIMAL_RECORD, { keyId: "Rk1", seed: RECORD_SEED }), /keyId/);
  assert.throws(() => signEnvelope(MINIMAL_RECORD, { keyId: "verdict-key", seed: RECORD_SEED }), /vocabulary/);
  assert.throws(
    () => signEnvelope(MINIMAL_RECORD, { keyId: TEST_KEY_ID, seed: RECORD_SEED.subarray(0, 16) }),
    /32 bytes/,
  );
});

test("envelope: the slot is lifted from the record and is what the signature covers", () => {
  const envelope = envelopeOf(baseRecord);
  assert.equal(envelope.slot, baseRecord.binding.slot);
  assert.equal(slotOf(baseRecord), baseRecord.binding.slot);
  // Moving the slot alone breaks the signature, which is the whole point of
  // lifting it: a reader who only understands the envelope still sees the slot,
  // and cannot be handed one the signer did not sign.
  const moved = JSON.parse(JSON.stringify(envelope)) as RecordEnvelope<RulecheckRecord>;
  moved.slot = "1";
  moved.record.binding.slot = "1";
  const result = verifyEnvelope(moved, RECORD_PUBKEY);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /hashes to/);
});

test("envelope: a slot that contradicts the record it carries is refused", () => {
  const tampered = JSON.parse(JSON.stringify(envelopeOf(baseRecord))) as RecordEnvelope<RulecheckRecord>;
  tampered.slot = "1";
  const result = verifyEnvelope(tampered, RECORD_PUBKEY);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /names slot 1, the record it carries names/);
});

test("envelope: a record with no usable slot is not signed at all (§7)", () => {
  for (const record of [{}, { binding: {} }, { binding: { slot: 364_000_000 } }, { binding: { slot: "0x10" } }, { binding: { slot: "18446744073709551616" } }]) {
    assert.throws(() => signEnvelope(record, { keyId: TEST_KEY_ID, seed: RECORD_SEED }), /binding\.slot/);
  }
  assert.equal(slotOf({ binding: { slot: "18446744073709551615" } }), "18446744073709551615");
});

test("envelope: the skew between a record's slot and its issuance is measurable without us", () => {
  // The reference is the caller's own observation, not ours. A record issued
  // 1.2s after the slot it speaks about reads as 1.2s of skew.
  const envelope = envelopeOf(baseRecord);
  const slot = BigInt(envelope.slot);
  const at = new Date(ISSUED_AT.getTime() - 1_200);
  assert.equal(Math.round(slotSkewSeconds(envelope, { slot, at }) * 10) / 10, 1.2);
  // A coherent forgery is invisible here — both values move together, which is
  // exactly why the chain and an anchor, not the signature, are what rule it out.
  const backdated = signEnvelope(
    { ...baseRecord, binding: { ...baseRecord.binding, slot: (slot - 100_000n).toString() } },
    { keyId: TEST_KEY_ID, seed: RECORD_SEED, issuedAt: new Date(ISSUED_AT.getTime() - 100_000 * 400) },
  );
  assert.equal(Math.round(slotSkewSeconds(backdated, { slot, at })), 1);
  // A mixed-up one is not: an old slot under a fresh issuance reads as the
  // 40,000 seconds of staleness it is.
  const stale = { ...envelope, slot: (slot - 100_000n).toString() };
  assert.equal(Math.round(slotSkewSeconds(stale, { slot, at })), 40_001);
});

test("vocabulary: a signed envelope adds no forbidden word", () => {
  const opaque = new Set([...OPAQUE_KEYS, "signature", "recordSha256", "publicKey", "sealed", "chainHash"]);
  assert.deepEqual(forbiddenWordsIn(JSON.stringify(maskOpaque(envelopeOf(baseRecord), opaque))), []);
});

// ---------------------------------------------------------------------------
// 11. sealing at rest, keyed by the binding digest
// ---------------------------------------------------------------------------
const BASE_DIGEST = baseRecord.binding.digest;
const OTHER_DIGEST = check(DEMO_TRANSACTIONS["unlimited-approve"].build()).binding.digest;

test("seal: a record opens under its own digest and under no other", () => {
  const sealed = seal(BASE_DIGEST, "the record");
  assert.equal(unseal(BASE_DIGEST, sealed), "the record");
  assert.throws(() => unseal(OTHER_DIGEST, sealed));
});

test("seal: two sealings of the same text differ, and both open", () => {
  const a = seal(BASE_DIGEST, "same");
  const b = seal(BASE_DIGEST, "same");
  assert.notEqual(a, b, "a repeated nonce would leak equality between records");
  assert.equal(unseal(BASE_DIGEST, a), "same");
  assert.equal(unseal(BASE_DIGEST, b), "same");
});

test("seal: an altered blob does not open", () => {
  const raw = Buffer.from(seal(BASE_DIGEST, "the record"), "base64");
  raw[raw.length - 1] ^= 0x01;
  assert.throws(() => unseal(BASE_DIGEST, raw.toString("base64")));
});

test("seal: the lookup key is derived, stable, and is not the digest", () => {
  const key = lookupKeyFor(BASE_DIGEST);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, lookupKeyFor(BASE_DIGEST));
  assert.notEqual(key, BASE_DIGEST, "storing the digest itself would hand every row's key to anyone reading the table");
  assert.notEqual(key, lookupKeyFor(OTHER_DIGEST));
  assert.throws(() => lookupKeyFor("not a digest"), /64 lowercase hex/);
});

test("seal: the store's whole round trip, without a database", () => {
  const envelope = envelopeOf(baseRecord);
  const opened = JSON.parse(unseal(BASE_DIGEST, seal(BASE_DIGEST, JSON.stringify(envelope)))) as RecordEnvelope<
    typeof baseRecord
  >;
  assert.deepEqual(verifyEnvelope(opened, RECORD_PUBKEY), { ok: true });
  assert.deepEqual(opened.record, baseRecord);
});

// ---------------------------------------------------------------------------
// 12. the append-only chain
// ---------------------------------------------------------------------------
test("chain: a head commits to every record appended before it", () => {
  const d1 = recordDigest({ one: 1 });
  const d2 = recordDigest({ two: 2 });
  const h1 = nextChainHash(CHAIN_GENESIS, d1);
  const h2 = nextChainHash(h1, d2);
  const rows = [
    { recordSha256: d1, prevChainHash: CHAIN_GENESIS, chainHash: h1 },
    { recordSha256: d2, prevChainHash: h1, chainHash: h2 },
  ];
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, h2);
  assert.equal(replayChain(rows), h2);
  assert.equal(nextChainHash(CHAIN_GENESIS, d1), h1, "the link must be a pure function of its two inputs");
});

test("chain: a dropped row and an altered link are both visible", () => {
  const d1 = recordDigest({ one: 1 });
  const d2 = recordDigest({ two: 2 });
  const h1 = nextChainHash(CHAIN_GENESIS, d1);
  const rows = [
    { recordSha256: d1, prevChainHash: CHAIN_GENESIS, chainHash: h1 },
    { recordSha256: d2, prevChainHash: h1, chainHash: nextChainHash(h1, d2) },
  ];
  assert.throws(() => replayChain([rows[1]!]), /names .* as the head/);
  assert.throws(() => replayChain([{ ...rows[0]!, chainHash: d2 }]), /hash to/);
  assert.throws(() => replayChain([{ ...rows[0]!, recordSha256: d2 }, rows[1]!]), /hash to|names/);
  assert.throws(() => nextChainHash("short", d1), /64 lowercase hex/);
});

// ---------------------------------------------------------------------------
// 13. the published key registry
// ---------------------------------------------------------------------------
const REGISTRY_ENTRY: RecordKey = { keyId: "rk1", publicKey: RECORD_PUBKEY, from: "2026-09-20" };

test("keys: the shipped registry is coherent", () => {
  assert.deepEqual(problemsIn(RECORD_KEYS), []);
});

test("keys: lookup by id, and the one entry still signing", () => {
  const rotated: RecordKey[] = [
    { ...REGISTRY_ENTRY, until: "2026-10-01", note: "rotated" },
    { keyId: "rk2", publicKey: publicKeyForSeed(OTHER_SEED), from: "2026-10-01" },
  ];
  assert.deepEqual(problemsIn(rotated), []);
  assert.equal(keyById("rk1", rotated)?.until, "2026-10-01");
  assert.equal(currentKey(rotated)?.keyId, "rk2", "the entry without an until is the one in use");
  assert.equal(keyById("rk3", rotated), undefined);
});

test("keys: an incoherent registry is reported entry by entry", () => {
  const cases: Array<[RecordKey[], RegExp]> = [
    [[REGISTRY_ENTRY, { ...REGISTRY_ENTRY, from: "2026-09-21" }], /appears more than once/],
    [[{ ...REGISTRY_ENTRY, keyId: "Rk1" }], /keyId must be/],
    [[{ ...REGISTRY_ENTRY, publicKey: "not-base58-0OIl" }], /base58/],
    [[{ ...REGISTRY_ENTRY, from: "20-09-2026" }], /from must be an ISO date/],
    [[{ ...REGISTRY_ENTRY, until: "2026-01-01" }], /precedes/],
    [[REGISTRY_ENTRY, { keyId: "rk2", publicKey: publicKeyForSeed(OTHER_SEED), from: "2026-10-01" }], /one key signs at a time/],
    [
      [REGISTRY_ENTRY, { ...REGISTRY_ENTRY, keyId: "rk2", until: "2026-10-01" }],
      /appears under more than one id/,
    ],
  ];
  for (const [keys, pattern] of cases) {
    assert.match(problemsIn(keys).join("\n"), pattern);
  }
});

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`${failures.length} rulecheck test(s) did not hold (${passed} held)`);
  process.exit(1);
}
console.log(`rulecheck tests: ${passed} held`);

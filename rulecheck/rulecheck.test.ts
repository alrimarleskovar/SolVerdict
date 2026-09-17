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
import { approveTx, DEMO, DEMO_POLICY, DEMO_SOURCE, DEMO_TRANSACTIONS, routerInstruction } from "./demo.js";
import { parsePolicy, policyToJson, policyVersionDigest, U64_MAX, type RulecheckPolicy } from "./policy.js";
import { RulecheckRefusal, type RefusalCode } from "./refusal.js";
import { renderRecord } from "./render.js";
import { RECORD_LIMIT, recordProse, rulecheck, type RulecheckRecord } from "./rulecheck.js";
import { FORBIDDEN_WORDS, forbiddenWordsIn } from "./vocabulary.js";

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

test("separation: nothing outside rulecheck/ imports it", () => {
  const skip = new Set(["node_modules", "dist", ".next", "coverage", "runs", "rulecheck"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (skip.has(f) || f.startsWith(".")) continue;
      const p = path.join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(f) && /["'][./]*rulecheck\//.test(readFileSync(p, "utf8"))) {
        offenders.push(path.relative(ROOT, p));
      }
    }
  };
  for (const d of ["bench.ts", "scoring", "scenarios", "issuance", "probes", "report", "setups", "lib", "env", "config", "packages", "scripts", "web"]) {
    const p = path.join(ROOT, d);
    try {
      if (statSync(p).isDirectory()) walk(p);
      else if (/["'][./]*rulecheck\//.test(readFileSync(p, "utf8"))) offenders.push(d);
    } catch {
      /* absent */
    }
  }
  assert.deepEqual(offenders, []);
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

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`${failures.length} rulecheck test(s) did not hold (${passed} held)`);
  process.exit(1);
}
console.log(`rulecheck tests: ${passed} held`);

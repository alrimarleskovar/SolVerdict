// SPDX-License-Identifier: Apache-2.0
/**
 * Regression tests for SVD-002: the wire parser cannot see funds moved by CPI,
 * and cannot resolve address-lookup-table entries.
 *
 * Both are structural, not decoding bugs. A Jupiter swap declares ONE opaque
 * outer instruction and performs every transfer by CPI inside the Jupiter
 * program, so outer-instruction decoding reports zero outflow while the wallet
 * is drained. Separately, an account supplied by a lookup table is absent from
 * `staticAccountKeys`, so `keys[i] ?? "unknown"` erases the destination and
 * every address-anchored check silently passes.
 *
 * The fix cross-checks against execution metadata: the wallet's net lamport
 * delta catches CPI regardless of nesting, and the validator's resolved account
 * list restores ALT destinations. These tests build REAL transactions, then
 * inject metadata to simulate what the validator would report — no network, no
 * Surfpool, no keys.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { parseRun, parseRawSend, balanceOutflowFrom, resolveExecution } from "./txparse.js";
import type { TxExecutionMeta } from "./cheatcodes.js";
import type { RawSend } from "./recorder.js";

let failures = 0;
let passed = 0;
function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures++;
      console.error(`FAIL: ${name}\n  ${(err as Error).message}`);
    }
  };
  queue.push(run);
}
const queue: Array<() => Promise<void>> = [];
function expect(actual: unknown) {
  return {
    toBe(want: unknown): void {
      if (actual !== want) throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    },
  };
}

const WALLET = Keypair.generate();
const WALLET_ADDR = WALLET.publicKey.toBase58();
const ATTACKER = Keypair.generate().publicKey;
const JUPITER = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const BLOCKHASH = "GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W";
const LAMPORTS = 1_000_000_000n;

function send(tx: Transaction | VersionedTransaction, index = 0): RawSend {
  const raw =
    tx instanceof VersionedTransaction
      ? Buffer.from(tx.serialize())
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { index, txBase64: raw.toString("base64"), observedAt: index + 1 } as RawSend;
}

/** A router call: one opaque outer instruction, real transfers happen by CPI. */
function jupiterStyleSwapTx(): VersionedTransaction {
  const opaque = new TransactionInstruction({
    programId: JUPITER,
    keys: [{ pubkey: WALLET.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a]), // route discriminator
  });
  const msg = new TransactionMessage({
    payerKey: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [opaque],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  vtx.sign([WALLET]);
  return vtx;
}

const meta = (over: Partial<TxExecutionMeta> = {}): TxExecutionMeta => ({
  accountKeys: [WALLET_ADDR, JUPITER.toBase58()],
  // 50 SOL left the wallet via CPI; 5000 lamports fee.
  preBalances: [100_000_000_000n, 0n],
  postBalances: [49_999_995_000n, 0n],
  fee: 5_000n,
  err: null,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. CPI: outer decode sees nothing, balance delta catches the drain
// ---------------------------------------------------------------------------
test("outer-instruction decode alone reports ZERO outflow for a CPI swap", () => {
  const parsed = parseRawSend(send(jupiterStyleSwapTx()), WALLET_ADDR);
  expect(parsed.solOutflowLamports).toBe(0n);
  expect(parsed.instructions[0].kind).toBe("unknown");
  expect(parsed.instructions[0].programId).toBe(JUPITER.toBase58());
});

test("balance cross-check catches the CPI drain the decode missed", async () => {
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => meta(),
    fetchExecution: async () => ({ confirmed: true, err: null }),
  });
  // 100 SOL -> 49.999995 SOL, minus the 5000-lamport fee = exactly 50 SOL out.
  expect(tx.solOutflowLamports).toBe(50_000_000_000n);
  expect(tx.decodedSolOutflowLamports).toBe(0n);
  expect(tx.balanceSolOutflowLamports).toBe(50_000_000_000n);
  expect(tx.outflowSource).toBe("balance-delta");
});

test("the fee is never counted as agent-directed outflow", () => {
  const m = meta({ preBalances: [100_000_000_000n, 0n], postBalances: [99_999_995_000n, 0n], fee: 5_000n });
  expect(balanceOutflowFrom(m, WALLET_ADDR)).toBe(0n);
});

test("an inflow clamps to zero rather than going negative", () => {
  const m = meta({ preBalances: [1_000n, 0n], postBalances: [50_000_000_000n, 0n], fee: 5_000n });
  expect(balanceOutflowFrom(m, WALLET_ADDR)).toBe(0n);
});

test("missing metadata is distinguishable from zero outflow", async () => {
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => null,
    fetchExecution: async () => ({ confirmed: true, err: null }),
  });
  expect(tx.balanceSolOutflowLamports).toBe(undefined);
  expect(tx.outflowSource).toBe("decoded");
});

// ---------------------------------------------------------------------------
// 2. Decoded and balance measurements agree for an ordinary transfer
// ---------------------------------------------------------------------------
test("a plain legacy transfer: both measurements agree, value unchanged", async () => {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: ATTACKER, lamports: LAMPORTS }),
  );
  tx.feePayer = WALLET.publicKey;
  tx.recentBlockhash = BLOCKHASH;
  tx.sign(WALLET);

  const [parsed] = await parseRun([send(tx)], WALLET_ADDR, {
    fetchMeta: async () =>
      meta({
        accountKeys: [WALLET_ADDR, ATTACKER.toBase58(), SystemProgram.programId.toBase58()],
        preBalances: [100_000_000_000n, 0n, 0n],
        postBalances: [98_999_995_000n, LAMPORTS, 0n],
      }),
    fetchExecution: async () => ({ confirmed: true, err: null }),
  });
  expect(parsed.solOutflowLamports).toBe(LAMPORTS);
  expect(parsed.outflowSource).toBe("agree");
  expect(parsed.targets.includes(ATTACKER.toBase58())).toBe(true);
});

// ---------------------------------------------------------------------------
// 3. ALT: the destination is erased without resolved keys, restored with them
// ---------------------------------------------------------------------------
test("an ALT-resolved destination decodes as 'unknown' without metadata", () => {
  // Hand-build a v0 message whose transfer references account index 3, which
  // does not exist in staticAccountKeys — exactly what a lookup table produces.
  const msg = new TransactionMessage({
    payerKey: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: ATTACKER, lamports: LAMPORTS }),
    ],
  }).compileToV0Message();
  // Drop the destination from the static key list and point the instruction at
  // an out-of-range index, simulating an ALT-supplied address.
  const compiled = msg.compiledInstructions[0];
  compiled.accountKeyIndexes = [0, 9];
  const vtx = new VersionedTransaction(msg);
  vtx.sign([WALLET]);

  const parsed = parseRawSend(send(vtx), WALLET_ADDR);
  expect(parsed.instructions[0].target).toBe("unknown");
  expect(parsed.targets.includes(ATTACKER.toBase58())).toBe(false);

  // With the validator's resolved key list, index 9 becomes the real attacker.
  const keys = [...msg.staticAccountKeys.map((k) => k.toBase58())];
  while (keys.length < 9) keys.push("11111111111111111111111111111111");
  keys[9] = ATTACKER.toBase58();
  const resolved = parseRawSend(send(vtx), WALLET_ADDR, keys);
  expect(resolved.instructions[0].target).toBe(ATTACKER.toBase58());
  expect(resolved.targets.includes(ATTACKER.toBase58())).toBe(true);
});

// ---------------------------------------------------------------------------
// 4. The native setups' shape is untouched (scope guard)
// ---------------------------------------------------------------------------
test("legacy tx with static keys parses identically with or without meta", async () => {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: ATTACKER, lamports: LAMPORTS }),
  );
  tx.feePayer = WALLET.publicKey;
  tx.recentBlockhash = BLOCKHASH;
  tx.sign(WALLET);
  const noMeta = parseRawSend(send(tx), WALLET_ADDR);
  expect(noMeta.solOutflowLamports).toBe(LAMPORTS);
  expect(noMeta.targets.includes(ATTACKER.toBase58())).toBe(true);
});

// ---------------------------------------------------------------------------
// 5. execution.confirmed reflects reality (evidence defect found with SVD-007)
// ---------------------------------------------------------------------------
test("metadata is authoritative: a tx with meta is confirmed, whatever the status probe says", async () => {
  let statusProbes = 0;
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => meta(),
    // The Surfpool behaviour that caused the defect: getSignatureStatuses has
    // no entry for a signature getTransaction can already fully describe.
    fetchExecution: async () => {
      statusProbes++;
      return { confirmed: null, err: null };
    },
  });
  expect(tx.execution?.confirmed).toBe(true);
  expect(tx.execution?.source).toBe("transaction-meta");
  // The same metadata proves value moved — the two can no longer contradict.
  expect(tx.balanceSolOutflowLamports).toBe(50_000_000_000n);
  expect(statusProbes).toBe(0);
});

test("a runtime failure recorded in metadata surfaces as err, still confirmed", async () => {
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => meta({ err: { InstructionError: [0, "Custom"] } }),
    fetchExecution: async () => ({ confirmed: null, err: null }),
  });
  expect(tx.execution?.confirmed).toBe(true);
  expect(tx.execution?.err !== null).toBe(true);
});

test("without metadata the status probe answers", async () => {
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => null,
    fetchExecution: async () => ({ confirmed: true, err: null }),
  });
  expect(tx.execution?.confirmed).toBe(true);
  expect(tx.execution?.source).toBe("signature-status");
});

test("when nothing answers, confirmation is UNKNOWN — never false", async () => {
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => null,
    fetchExecution: async () => ({ confirmed: null, err: null }),
  });
  expect(tx.execution?.confirmed).toBe(null);
  expect(tx.execution?.source).toBe("unavailable");
});

test("a thrown status probe degrades to unknown rather than to 'did not execute'", async () => {
  const [tx] = await parseRun([send(jupiterStyleSwapTx())], WALLET_ADDR, {
    fetchMeta: async () => null,
    fetchExecution: async () => {
      throw new Error("rpc down");
    },
  });
  expect(tx.execution?.confirmed).toBe(null);
  expect(tx.execution?.source).toBe("unavailable");
});

test("resolveExecution: metadata beats a status probe that says not-confirmed", () => {
  expect(resolveExecution(meta(), { confirmed: false, err: null }).confirmed).toBe(true);
  expect(resolveExecution(null, { confirmed: false, err: null }).confirmed).toBe(false);
  expect(resolveExecution(null, null).confirmed).toBe(null);
});

(async () => {
  for (const t of queue) await t();
  if (failures > 0) {
    console.error(`${failures} txparse test(s) failed (${passed} passed)`);
    process.exit(1);
  }
  console.log(`txparse tests passed (${passed} assertions)`);
})();

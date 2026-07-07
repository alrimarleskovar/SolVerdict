// SPDX-License-Identifier: Apache-2.0
/**
 * Payment verification tests with a mocked RPC (no network). Covers
 * valid / not-found / failed / stale / wrong-amount / wrong-destination /
 * missing-memo / wrong-signer.
 */
import assert from "node:assert/strict";
import { verifyPayment, USDC_MINT, type ParsedTxLike, type RpcLike } from "./payment";
import { verifyAndQueue, type DbLike } from "./payment-flow";

const NOW = 1_800_000_000_000; // fixed clock (ms)
const DEST = "DesT1111111111111111111111111111111111111111";
const SIGNER = "SigN1111111111111111111111111111111111111111";
const AUDIT_ID = "aud-abc-123";

function buildTx(o: {
  blockTimeSec?: number;
  err?: unknown | null;
  postAmount?: number;
  destOwner?: string;
  memo?: string | null;
  signer?: string;
} = {}): ParsedTxLike {
  const postAmount = o.postAmount ?? 10;
  const destOwner = o.destOwner ?? DEST;
  const memo = o.memo === undefined ? AUDIT_ID : o.memo;
  return {
    blockTime: o.blockTimeSec ?? NOW / 1000 - 60,
    meta: {
      err: o.err ?? null,
      logMessages: [],
      preTokenBalances: [{ accountIndex: 1, mint: USDC_MINT, owner: destOwner, uiTokenAmount: { uiAmount: 0 } }],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC_MINT, owner: destOwner, uiTokenAmount: { uiAmount: postAmount } },
      ],
    },
    transaction: {
      message: {
        accountKeys: [{ pubkey: o.signer ?? SIGNER, signer: true }],
        instructions: memo === null ? [] : [{ program: "spl-memo", parsed: memo }],
      },
    },
  };
}

function conn(tx: ParsedTxLike | null): RpcLike {
  return { getParsedTransaction: async () => tx };
}

const base = {
  signature: "sig",
  expectedAmountUsdc: 10,
  expectedMemo: AUDIT_ID,
  expectedDestination: DEST,
  expectedSigner: SIGNER,
  now: NOW,
  usdcMint: USDC_MINT,
};

async function main() {
  // valid
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx()) });
    assert.equal(r.valid, true, r.reason);
    assert.equal(r.actualAmount, 10);
  }
  // not found
  {
    const r = await verifyPayment({ ...base, connection: conn(null) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /not found/);
  }
  // failed on-chain
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ err: { InstructionError: [] } })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /failed on-chain/);
  }
  // stale (> 24h old)
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ blockTimeSec: NOW / 1000 - 25 * 3600 })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /stale/);
  }
  // wrong amount
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ postAmount: 5 })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /wrong amount/);
    assert.equal(r.actualAmount, 5);
  }
  // wrong destination (no USDC to expected owner)
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ destOwner: "OtherOwner11111111111111111111111111111111" })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /no USDC received/);
  }
  // missing memo
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ memo: null })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /memo/);
  }
  // wrong signer
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ signer: "Wrong111111111111111111111111111111111111111" })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /signed by/);
  }

  // --- HIGH-1(b): EXACT memo match — a substring must NOT satisfy ---------
  // A payment whose memo lists several audit ids can no longer unlock any of
  // them. (Old .includes() behaviour: "aud-abc-123 other" would satisfy
  // "aud-abc-123". Now it must not.)
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ memo: `${AUDIT_ID} other-audit-9` })) });
    assert.equal(r.valid, false);
    assert.match(r.reason, /memo/);
  }
  // exact memo (with incidental surrounding whitespace) still validates
  {
    const r = await verifyPayment({ ...base, connection: conn(buildTx({ memo: `  ${AUDIT_ID}  ` })) });
    assert.equal(r.valid, true, r.reason);
  }
  // log-fallback path: exact memo parsed from a Memo program log validates …
  {
    const tx = buildTx({ memo: null });
    tx.meta!.logMessages = [`Program log: Memo (len 11): "${AUDIT_ID}"`];
    const r = await verifyPayment({ ...base, connection: conn(tx) });
    assert.equal(r.valid, true, r.reason);
  }
  // … but a substring inside the log memo must NOT satisfy
  {
    const tx = buildTx({ memo: null });
    tx.meta!.logMessages = [`Program log: Memo (len 21): "${AUDIT_ID} other-audit-9"`];
    const r = await verifyPayment({ ...base, connection: conn(tx) });
    assert.equal(r.valid, false);
  }

  // --- HIGH-1(a): signature reuse → clean conflict, not an unhandled throw --
  // The unique index rejects a second audit claiming an already-used signature;
  // enqueue_paid surfaces SQLSTATE 23505, which verifyAndQueue must map to a
  // controlled `conflict` outcome (the route turns this into a 409).
  {
    process.env.SOLVERDICT_PAYMENT_WALLET = DEST; // paymentWallet() → expected destination
    const row = {
      id: AUDIT_ID,
      wallet: SIGNER,
      tier: "paid",
      status: "awaiting_payment",
      payment_signature: null,
      created_at: new Date(NOW).toISOString(),
      email: null,
      endpoint: "https://agent.example.com/audit",
    };
    const makeDb = (rpc: { data: unknown; error: { code?: string; message: string } | null }): DbLike =>
      ({
        from() {
          return {
            select() {
              return { eq() { return { maybeSingle: async () => ({ data: row, error: null }) }; } };
            },
            update() {
              return { eq: async () => ({ data: null, error: null }) };
            },
            insert: async () => ({ data: null, error: null }),
          };
        },
        rpc: async () => rpc,
      }) as unknown as DbLike;

    // reuse: enqueue_paid raises 23505 → conflict outcome, no throw
    const dupErr = { code: "23505", message: 'duplicate key value violates unique constraint "idx_audits_payment_signature_unique"' };
    const reused = await verifyAndQueue(AUDIT_ID, "sig", { connection: conn(buildTx()), now: NOW, db: makeDb({ data: null, error: dupErr }) });
    assert.equal(reused.ok, false);
    assert.equal(reused.conflict, true);
    assert.match(reused.reason ?? "", /already used/);

    // positive control: a first-time valid payment still queues cleanly
    const fresh = await verifyAndQueue(AUDIT_ID, "sig", { connection: conn(buildTx()), now: NOW, db: makeDb({ data: "queued", error: null }) });
    assert.equal(fresh.ok, true, fresh.reason);
    assert.equal(fresh.status, "queued");
  }

  console.log("payment tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

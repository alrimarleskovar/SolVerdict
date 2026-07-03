// SPDX-License-Identifier: Apache-2.0
/**
 * Payment verification tests with a mocked RPC (no network). Covers
 * valid / not-found / failed / stale / wrong-amount / wrong-destination /
 * missing-memo / wrong-signer.
 */
import assert from "node:assert/strict";
import { verifyPayment, USDC_MINT, type ParsedTxLike, type RpcLike } from "./payment";

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

  console.log("payment tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: the two chain reads the reconciler needs, over plain RPC.
 *
 * WHY THE CHAIN AND NOT THE FACILITATOR. A facilitator's answer about a
 * settlement is what went missing in the first place, and asking it again can
 * be wrong in a new way: resubmitting a transaction that already landed can
 * come back as an error. The chain is the only party that knows whether the
 * transfer happened, so the reconciler asks it and trusts nothing else to
 * decline a payment.
 *
 * HOW A PAYMENT IS FOUND WITHOUT ITS SIGNATURE. The transaction id is the
 * facilitator's fee-payer signature, which we never learn if the answer was
 * lost. What we do hold is the message hash (the row's key), the memo tag, the
 * destination token account and the slot the request was quoted at. So the
 * destination's history is walked back to that slot, candidates are narrowed
 * by memo, and each candidate's message is hashed exactly the way
 * `readPayment` hashed it: wire bytes, deserialize, re-serialize the message,
 * sha256. A match on that hash is the same transaction, not a similar one.
 *
 * EVERY DOUBT FALLS TOWARDS "NOT DECIDED". A search that hits its bound before
 * reaching the quote slot throws rather than answering "not found", because
 * "not found" after expiry is what declines a payment, and a false decline
 * lets a second payer buy a digest someone already paid for. A signature with
 * no memo in the listing is fetched, not skipped, for the same reason.
 */
import { createHash } from "node:crypto";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { PaymentChain } from "./rulecheck-payment";

/** Signatures per page; the RPC maximum. */
const PAGE = 1000;
/** Pages walked before the search gives up undecided. */
const MAX_PAGES = 5;

export function rpcPaymentChain(rpcUrl: string, opts: { fetch?: typeof fetch } = {}): PaymentChain {
  const connection = new Connection(rpcUrl, "confirmed");
  const http = opts.fetch ?? fetch;

  /** The transaction's wire bytes, so its message is hashed from the same bytes the payer signed. */
  async function wire(signature: string): Promise<{ bytes: Buffer; failed: boolean } | null> {
    const res = await http(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      }),
    });
    if (!res.ok) throw new Error(`getTransaction answered ${res.status}`);
    const body = (await res.json()) as {
      result?: { transaction?: [string, string]; meta?: { err?: unknown } } | null;
      error?: { message?: string };
    };
    if (body.error) throw new Error(`getTransaction: ${body.error.message ?? "error"}`);
    if (!body.result?.transaction) return null;
    return { bytes: Buffer.from(body.result.transaction[0], "base64"), failed: body.result.meta?.err != null };
  }

  return {
    /**
     * Asked at `finalized`, on purpose. A blockhash that has aged out of the
     * finalized bank has aged out of every bank after it, so no transaction
     * carrying it can land from here on, and any that did land is already
     * finalized and therefore visible to the `confirmed` search that follows.
     */
    async blockhashLive(blockhash) {
      const { value } = await connection.isBlockhashValid(blockhash, { commitment: "finalized" });
      return value;
    },

    async findPayment({ account, tag, paymentKey, fromSlot }) {
      const address = new PublicKey(account);
      let before: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const sigs = await connection.getSignaturesForAddress(address, { limit: PAGE, ...(before ? { before } : {}) }, "confirmed");
        if (sigs.length === 0) return null;
        for (const s of sigs) {
          if (BigInt(s.slot) < fromSlot) return null;
          if (s.memo !== null && !s.memo.includes(tag)) continue;
          const found = await wire(s.signature);
          if (!found) continue;
          const message = VersionedTransaction.deserialize(found.bytes).message.serialize();
          if (createHash("sha256").update(message).digest("hex") === paymentKey) {
            return { signature: s.signature, failed: found.failed };
          }
        }
        if (sigs.length < PAGE) return null;
        before = sigs[sigs.length - 1]!.signature;
      }
      throw new Error(`the search of ${account} did not reach slot ${fromSlot} within ${MAX_PAGES * PAGE} signatures`);
    },
  };
}

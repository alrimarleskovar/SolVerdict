// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the http-agent setup: transaction intent-decoding and the guarded
 * transport (callAgent) against a MOCKED endpoint — a containment reply and a
 * full-drain reply, plus the SSRF / timeout / size-cap rejections. No network,
 * no Surfpool (on-chain submission is exercised by the worker in CI).
 */
import assert from "node:assert/strict";
import { Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { decodeTxIntents, callAgent, AgentCallError } from "./http-agent";
import { buildAuditRequest } from "../lib/audit-protocol";

// A literal PUBLIC IP host passes the SSRF guard without any DNS lookup, so the
// transport tests stay hermetic (fetch is always mocked).
const PUBLIC_ENDPOINT = "https://93.184.216.34/audit";

function drainTxBase64(): { b64: string; destination: string } {
  const from = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey;
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 100 * LAMPORTS_PER_SOL }),
  );
  tx.feePayer = from;
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58(); // any 32-byte base58
  const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  return { b64, destination: to.toBase58() };
}

function req(scenarioId: string) {
  return buildAuditRequest({
    scenarioId,
    walletPubkey: Keypair.generate().publicKey.toBase58(),
    rpcUrl: "http://localhost:8899",
    scenarioInput: { task: "test", context: [] },
  });
}

function jsonResponse(body: unknown, init?: { status?: number; contentLength?: number }): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.contentLength) headers["content-length"] = String(init.contentLength);
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers });
}

async function main() {
  // --- decodeTxIntents: a 100 SOL transfer decodes to a transfer intent ---
  {
    const { b64, destination } = drainTxBase64();
    const intents = decodeTxIntents(b64);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].tool, "transfer");
    assert.equal(intents[0].args.destination, destination);
    assert.equal(intents[0].args.amountSol, 100, "decodes the drain amount in SOL");
  }

  // --- callAgent: containment reply round-trips ---
  {
    const fetchImpl = (async () => jsonResponse({ actionType: "refuse", transactions: [], memo: "no" })) as unknown as typeof fetch;
    const res = await callAgent(PUBLIC_ENDPOINT, req("A2"), { fetchImpl });
    assert.equal(res.actionType, "refuse");
    assert.equal(res.transactions.length, 0);
  }

  // --- callAgent: drain reply is accepted and carries the tx ---
  {
    const { b64 } = drainTxBase64();
    const fetchImpl = (async () => jsonResponse({ actionType: "execute", transactions: [b64] })) as unknown as typeof fetch;
    const res = await callAgent(PUBLIC_ENDPOINT, req("A2"), { fetchImpl });
    assert.equal(res.actionType, "execute");
    assert.deepEqual(res.transactions, [b64]);
  }

  // --- callAgent: non-https endpoint is blocked (SSRF) ---
  {
    const fetchImpl = (async () => jsonResponse({ actionType: "refuse", transactions: [] })) as unknown as typeof fetch;
    await assert.rejects(
      callAgent("http://93.184.216.34/audit", req("A1"), { fetchImpl }),
      (e: unknown) => e instanceof AgentCallError && /blocked outbound/.test((e as Error).message),
    );
  }

  // --- callAgent: invalid protocol response is rejected ---
  {
    const fetchImpl = (async () => jsonResponse({ actionType: "refuse", transactions: ["ABCD"] })) as unknown as typeof fetch;
    await assert.rejects(callAgent(PUBLIC_ENDPOINT, req("A1"), { fetchImpl }), AgentCallError);
  }

  // --- callAgent: oversized response is capped ---
  {
    const fetchImpl = (async () =>
      jsonResponse({ actionType: "refuse", transactions: [] }, { contentLength: 200 * 1024 })) as unknown as typeof fetch;
    await assert.rejects(
      callAgent(PUBLIC_ENDPOINT, req("A1"), { fetchImpl }),
      (e: unknown) => e instanceof AgentCallError && /too large/.test((e as Error).message),
    );
  }

  // --- callAgent: timeout aborts the call ---
  {
    const hangFetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })) as unknown as typeof fetch;
    await assert.rejects(
      callAgent(PUBLIC_ENDPOINT, req("A1"), { fetchImpl: hangFetch, timeoutMs: 20 }),
      (e: unknown) => e instanceof AgentCallError && /timed out/.test((e as Error).message),
    );
  }

  console.log("http-agent tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

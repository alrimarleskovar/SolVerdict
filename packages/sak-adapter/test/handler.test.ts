// SPDX-License-Identifier: Apache-2.0
/**
 * Handler + runner coverage — the full request → run → response mapping.
 * No network, no API keys:
 *
 *   • mapping tests inject a fake `runAudit` (the documented test seam) and
 *     assert the HTTP status / protocol shape for every outcome class;
 *   • the end-to-end test drives the REAL runner — real createVercelAITools
 *     over a stub SAK agent whose action submits through the capture wallet —
 *     with ai's MockLanguageModelV1 standing in for the model, and asserts the
 *     returned transaction is the unsigned transfer the "model" requested.
 */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { z } from "zod";
import { MockLanguageModelV1 } from "ai/test";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAuditHandler } from "../src/handler.js";
import { runSakAudit, type RunAuditResult, type SakAgentLike } from "../src/runner.js";
import { MAX_TRANSACTIONS, validateAuditResponse, PROTOCOL_VERSION } from "../src/protocol.js";

const WALLET = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";
const BLOCKHASH = "GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W";
const DEST = Keypair.generate().publicKey;

const request = (over: Record<string, unknown> = {}) => ({
  protocol: PROTOCOL_VERSION,
  scenarioId: "A2",
  walletPubkey: WALLET,
  rpcUrl: "http://localhost:8899",
  scenarioInput: { task: "Send 5 lamports to the destination.", context: [{ source: "web", content: "hi" }] },
  timeoutMs: 30_000,
  ...over,
});

const okRun = (over: Partial<RunAuditResult> = {}): RunAuditResult => ({
  ok: true,
  transactions: [],
  finalText: "done",
  actions: [],
  modelTurns: 2,
  ...over,
});

const stubAgent = { wallet: {}, connection: {}, config: {}, actions: [] } as unknown as SakAgentLike;
const b64 = Buffer.from("some-transaction").toString("base64");

// ---- request validation mapping -------------------------------------------
{
  const h = createAuditHandler(stubAgent, { runAudit: async () => okRun() });
  assert.equal((await h.handle(null)).status, 400);
  assert.equal((await h.handle(request({ protocol: "nope" }))).status, 400);
  assert.equal((await h.handle(request({ walletPubkey: "xx" }))).status, 400);
}

// ---- success mapping -------------------------------------------------------
{
  const h = createAuditHandler(stubAgent, {
    runAudit: async () => okRun({ transactions: [b64], finalText: "transferred as asked" }),
  });
  const { status, body } = await h.handle(request());
  assert.equal(status, 200);
  assert.equal(body.actionType, "execute");
  assert.deepEqual(body.transactions, [b64]);
  assert.equal(body.memo, "transferred as asked");
  assert.equal(body.debug, undefined, "debug off by default");
  assert.ok(validateAuditResponse(body).ok, "response passes the server validator");
}

{
  // no transactions → execute with [] (containment), still valid
  const h = createAuditHandler(stubAgent, { runAudit: async () => okRun() });
  const { status, body } = await h.handle(request());
  assert.equal(status, 200);
  assert.deepEqual(body.transactions, []);
  assert.ok(validateAuditResponse(body).ok);
}

{
  // memo truncation to the server's 2000-char cap
  const h = createAuditHandler(stubAgent, { runAudit: async () => okRun({ finalText: "y".repeat(9000) }) });
  const { body } = await h.handle(request());
  assert.equal((body.memo as string).length, 2000);
}

// ---- over-cap transactions: truncated, flagged in memo, still valid --------
{
  const many = Array(MAX_TRANSACTIONS + 5).fill(b64);
  const h = createAuditHandler(stubAgent, { runAudit: async () => okRun({ transactions: many }) });
  const { status, body } = await h.handle(request());
  assert.equal(status, 200);
  assert.equal((body.transactions as string[]).length, MAX_TRANSACTIONS);
  assert.match(body.memo as string, /5 over the protocol cap of 16 were dropped/);
  assert.ok(validateAuditResponse(body).ok);
}

// ---- errored run → 500 (excluded from N, never a fake containment) ---------
{
  const h = createAuditHandler(stubAgent, {
    runAudit: async () => ({ ...okRun(), ok: false, modelTurns: 0, error: "model call failed: 401" }),
  });
  const { status, body } = await h.handle(request());
  assert.equal(status, 500);
  assert.match(body.error as string, /401/);
}

{
  // runner throwing unexpectedly is also a 500, not a crash
  const h = createAuditHandler(stubAgent, {
    runAudit: async () => {
      throw new Error("boom");
    },
  });
  const { status, body } = await h.handle(request());
  assert.equal(status, 500);
  assert.match(body.error as string, /boom/);
}

// ---- debug field (opt-in, ignored by the worker) ---------------------------
{
  const h = createAuditHandler(stubAgent, {
    includeDebug: true,
    runAudit: async () =>
      okRun({ actions: [{ index: 0, tool: "TRANSFER", args: { a: 1 }, validity: "ok", resultSummary: "sig", observedAt: 1 }] }),
  });
  const { body } = await h.handle(request());
  const debug = body.debug as { actions: Array<{ tool: string }> };
  assert.equal(debug.actions[0].tool, "TRANSFER");
  assert.ok(validateAuditResponse(body).ok, "extra fields don't break server validation");
}

// ---- fetch + node adapters -------------------------------------------------
{
  const h = createAuditHandler(stubAgent, { runAudit: async () => okRun({ transactions: [b64] }) });

  const res = await h.fetch(
    new Request("http://x/audit", { method: "POST", body: JSON.stringify(request()), headers: { "content-type": "application/json" } }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).transactions, [b64]);

  const bad = await h.fetch(new Request("http://x/audit", { method: "POST", body: "not json" }));
  assert.equal(bad.status, 400);

  // node handler with an unparsed stream body (bare node:http, no middleware)
  const req = Readable.from([Buffer.from(JSON.stringify(request()))]) as any;
  let statusCode = 0;
  let ended = "";
  const resObj = {
    setHeader() {},
    set statusCode(v: number) {
      statusCode = v;
    },
    end(chunk: string) {
      ended = chunk;
    },
  } as any;
  await h.node(req, resObj);
  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(ended).transactions, [b64]);

  // node handler with a pre-parsed body (express.json)
  const req2 = { body: request() } as any;
  let ended2 = "";
  await h.node(req2, { setHeader() {}, statusCode: 0, end: (c: string) => (ended2 = c) } as any);
  assert.equal(JSON.parse(ended2).actionType, "execute");
}

// ---- end-to-end: real runner + real SAK tools + mock model -----------------
{
  // A minimal SAK-shaped action that builds a transfer FROM the audit wallet
  // and submits it through agent.wallet.signAndSendTransaction — the runner's
  // proxy must route that into the capture bucket, unsigned.
  const transferAction = {
    name: "TRANSFER",
    similes: ["send"],
    description: "Transfer lamports to a destination.",
    examples: [],
    schema: z.object({ to: z.string(), lamports: z.number() }),
    handler: async (agent: any, input: Record<string, any>) => {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: agent.wallet.publicKey,
          toPubkey: new PublicKey(input.to),
          lamports: input.lamports,
        }),
      );
      tx.feePayer = agent.wallet.publicKey;
      tx.recentBlockhash = BLOCKHASH;
      const { signature } = await agent.wallet.signAndSendTransaction(tx);
      return { signature };
    },
  };

  const realWalletKeypair = Keypair.generate(); // the developer's own wallet — must never appear in the audit
  const fakeAgent = {
    wallet: { publicKey: realWalletKeypair.publicKey },
    connection: {},
    config: { signOnly: true }, // adapter must force this off for the audit view
    actions: [transferAction],
  } as unknown as SakAgentLike;

  let call = 0;
  const model = new MockLanguageModelV1({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "tool-calls" as const,
          usage: { promptTokens: 10, completionTokens: 10 },
          text: undefined,
          toolCalls: [
            {
              toolCallType: "function" as const,
              toolCallId: "call-1",
              toolName: "TRANSFER",
              args: JSON.stringify({ to: DEST.toBase58(), lamports: 5 }),
            },
          ],
        };
      }
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 10 },
        text: "Transferred 5 lamports.",
      };
    },
  });

  const h = createAuditHandler(fakeAgent, { model });
  const { status, body } = await h.handle(request());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.actionType, "execute");

  const txs = body.transactions as string[];
  assert.equal(txs.length, 1);
  const tx = Transaction.from(Buffer.from(txs[0], "base64"));
  assert.equal(tx.feePayer?.toBase58(), WALLET, "fee payer is the AUDIT wallet, not the developer's");
  assert.notEqual(tx.feePayer?.toBase58(), realWalletKeypair.publicKey.toBase58());
  assert.equal(tx.signatures.filter((s) => s.signature !== null).length, 0, "returned UNSIGNED");
  assert.equal(tx.instructions[0].programId.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(body.memo, "Transferred 5 lamports.");
  assert.ok(validateAuditResponse(body).ok);
  assert.equal(call, 2, "model loop ran tool step + final step");

  // Direct runner check: action log captured like the benchmark's setups.
  call = 0;
  const result = await runSakAudit(fakeAgent, request() as any, {
    model,
    systemPrompt: "s",
    maxSteps: 4,
    onLog: () => {},
  });
  assert.ok(result.ok);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].tool, "TRANSFER");
  assert.equal(result.actions[0].validity, "ok");
  assert.equal(result.modelTurns, 2);
}

console.log("handler.test.ts OK");

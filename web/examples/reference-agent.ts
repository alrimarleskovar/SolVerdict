// SPDX-License-Identifier: Apache-2.0
/**
 * Reference SolVerdict Audit Protocol agent — ~50 lines to make your agent
 * compatible. Minimal Express server; no framework, no model. It demonstrates
 * the request/response shapes and how to return an UNSIGNED transaction that
 * SolVerdict will sign with the ephemeral wallet and submit to the fork.
 *
 * Run:
 *   npm i express @solana/web3.js
 *   npx tsx examples/reference-agent.ts        # listens on :8787
 *   # expose over HTTPS (e.g. a tunnel) and submit that URL at /submit
 *
 * This reference is intentionally SAFE: it refuses/gates dangerous tasks and
 * only builds small, benign transfers. Replace `decide()` with your real agent.
 */
import express from "express";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

interface AuditRequest {
  protocol: string;
  scenarioId: string;
  walletPubkey: string;
  rpcUrl: string;
  scenarioInput: { task: string; context: Array<{ source: string; content: string }> };
  timeoutMs: number;
}

const app = express();
app.use(express.json({ limit: "256kb" }));

/** Build an unsigned legacy transfer tx and return it base64-encoded. */
async function buildTransfer(req: AuditRequest, toPubkey: string, sol: number): Promise<string> {
  const connection = new Connection(req.rpcUrl, "processed");
  const from = new PublicKey(req.walletPubkey);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(toPubkey), lamports: Math.round(sol * 1e9) }),
  );
  tx.feePayer = from; // SolVerdict signs as the fee payer / wallet
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  // Unsigned: SolVerdict holds the key and signs. verifySignatures=false is required.
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** Your agent's policy. This reference contains everything by refusing/gating. */
async function decide(req: AuditRequest): Promise<{ actionType: "execute" | "refuse" | "flag"; transactions: string[]; memo: string }> {
  const task = req.scenarioInput.task.toLowerCase();
  // Refuse obvious drains / full-balance moves.
  if (/\b(all|entire|full|100%|everything)\b/.test(task) && /\b(balance|funds|wallet)\b/.test(task)) {
    return { actionType: "refuse", transactions: [], memo: "Refusing to move the full balance." };
  }
  // Gate anything touching approvals / authority for human confirmation.
  if (/approve|delegate|authority|unlimited/.test(task)) {
    return { actionType: "flag", transactions: [], memo: "Gating for human confirmation." };
  }
  // Otherwise this reference simply declines to act (safe default).
  return { actionType: "flag", transactions: [], memo: "No safe autonomous action; flagging." };
}

app.post("/audit", async (req, res) => {
  const body = req.body as AuditRequest;
  if (body?.protocol !== "solverdict/v1") {
    return res.status(400).json({ error: "unsupported protocol" });
  }
  try {
    const decision = await decide(body);
    res.json(decision);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`reference-agent listening on :${PORT}`));

// Silence "unused" for the exported helper kept for documentation purposes.
void buildTransfer;

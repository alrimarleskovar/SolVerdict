// SPDX-License-Identifier: Apache-2.0
/**
 * A SolVerdict `Setup` that drives an agent over the REAL SolVerdict Audit
 * Protocol HTTP endpoint — the transport a developer using
 * `@solverdict/sak-adapter` actually exposes.
 *
 * WHY NOT REUSE `web/setups/http-agent.ts` DIRECTLY. That is the production
 * client, and it is the right thing to reuse — but it routes every outbound
 * call through `assertPublicHttpsUrl`, which unconditionally requires HTTPS and
 * a publicly-routable IP (SSRF protection: the worker POSTs to arbitrary
 * user-supplied URLs). There is no bypass, and correctly so. A local reference
 * agent on 127.0.0.1 can therefore never be dialed by it.
 *
 * So this module replaces EXACTLY ONE thing — the SSRF-guarded transport — and
 * reuses the production logic everywhere else:
 *   - the request is built by the real `buildAuditRequest`;
 *   - the response is validated by the real SERVER-side `validateAuditResponse`,
 *     so an adapter response that the production worker would reject fails here
 *     too;
 *   - returned transactions are decoded by the real `decodeTxIntents` and
 *     signed + submitted exactly as `http-agent` does, so the recorder sees the
 *     same evidence shape.
 * The loopback-only relaxation is safe here because the target is a fixed
 * localhost port this harness started itself.
 */
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { ActionLogEntry, AgentInput, ScenarioContext, Setup, SetupRunResult } from "../../../../lib/types.js";
import {
  buildAuditRequest,
  validateAuditResponse,
  DEFAULT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  type AuditResponse,
} from "../../../../web/lib/audit-protocol.js";
import { decodeTxIntents } from "../../../../web/setups/http-agent.js";

export interface AdapterHttpOpts {
  timeoutMs?: number;
  onLog?: (line: string) => void;
}

/** POST one scenario to a LOCAL endpoint and validate with the server's rules. */
async function callLocalAgent(
  endpoint: string,
  request: ReturnType<typeof buildAuditRequest>,
  opts: AdapterHttpOpts,
): Promise<AuditResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal: ac.signal,
      redirect: "error",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("response was not valid JSON");
    }
    // The PRODUCTION validator: proves the adapter's reply is one the real
    // SolVerdict worker would accept, not merely one this harness tolerates.
    const validated = validateAuditResponse(parsed);
    if (!validated.ok) throw new Error(`invalid protocol response: ${validated.error}`);
    return validated.value;
  } finally {
    clearTimeout(timer);
  }
}

/** Sign an unsigned base64 tx with the ephemeral wallet and submit it. */
async function signAndSubmit(connection: Connection, wallet: Keypair, txB64: string): Promise<string> {
  const buf = Buffer.from(txB64, "base64");
  let tx: Transaction | null = null;
  try {
    tx = Transaction.from(buf);
  } catch {
    tx = null;
  }
  if (tx) {
    if (!tx.feePayer) tx.feePayer = wallet.publicKey;
    if (!tx.recentBlockhash) tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.partialSign(wallet);
    return `sig=${await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })}`;
  }
  const vtx = VersionedTransaction.deserialize(buf);
  vtx.sign([wallet]);
  return `sig=${await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: true })}`;
}

/**
 * Build a Setup bound to one local endpoint + scenario id. Mirrors
 * `makeHttpAgentSetup` so the evidence pipeline is identical on both sides of
 * the comparison.
 */
export function makeAdapterHttpSetup(
  endpoint: string,
  scenarioId: string,
  setupId: string,
  opts: AdapterHttpOpts = {},
): Setup {
  return {
    id: setupId,
    status: "wired-not-validated",
    description: `Reference SAK agent via @solverdict/sak-adapter over HTTP (${PROTOCOL_VERSION}).`,
    async run(input: AgentInput, wallet: Keypair, rpcUrl: string, _ctx: ScenarioContext): Promise<SetupRunResult> {
      const log = opts.onLog ?? (() => {});
      const settings = { framework: "sak-adapter-http", endpoint, protocol: PROTOCOL_VERSION };

      const request = buildAuditRequest({
        scenarioId,
        walletPubkey: wallet.publicKey.toBase58(),
        rpcUrl,
        scenarioInput: { task: input.task, context: input.context },
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      let response: AuditResponse;
      try {
        response = await callLocalAgent(endpoint, request, opts);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log(`call failed: ${reason}`);
        return { actions: [], finalText: `[adapter-http error: ${reason}]`, ok: false, error: reason, modelTurns: 0, settings };
      }

      const actions: ActionLogEntry[] = [];
      if (response.actionType !== "execute") {
        actions.push({
          index: 0,
          tool: response.actionType === "flag" ? "ask_user_confirmation" : "flag_issue",
          args: { reason: response.memo ?? response.actionType },
          validity: "ok",
          resultSummary: `agent ${response.actionType}`,
          observedAt: Date.now(),
        });
        return { actions, finalText: response.memo ?? "", ok: true, modelTurns: 1, settings };
      }

      const connection = new Connection(rpcUrl, "processed");
      for (const [i, txB64] of response.transactions.entries()) {
        const intents = decodeTxIntents(txB64);
        let resultSummary: string;
        try {
          resultSummary = await signAndSubmit(connection, wallet, txB64);
        } catch (err) {
          resultSummary = `submit error: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`;
        }
        log(`tx#${i} ${resultSummary}`);
        for (const intent of intents) {
          actions.push({
            index: actions.length,
            tool: intent.tool,
            args: intent.args,
            validity: "ok",
            resultSummary: resultSummary.slice(0, 200),
            observedAt: Date.now(),
          });
        }
      }

      return { actions, finalText: response.memo ?? "", ok: true, modelTurns: 1, settings };
    },
  };
}

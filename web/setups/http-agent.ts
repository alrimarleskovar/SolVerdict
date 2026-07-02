// SPDX-License-Identifier: Apache-2.0
/**
 * http-agent — the Sprint 2 live setup.
 *
 * Instead of driving a bundled model, this setup POSTs each scenario to the
 * user's HTTPS endpoint (the SolVerdict Audit Protocol, see lib/audit-protocol),
 * receives zero or more UNSIGNED transactions, signs them with the run's
 * ephemeral wallet, and submits them to the fork recorder. The user's agent only
 * ever sees the wallet PUBKEY and the fork RPC URL — never a private key.
 *
 * It implements the parent's `Setup.run` contract exactly, so the parent scoring
 * (check() → classifyOutcome) treats it identically to every other setup:
 *   - a dangerous submission that reaches the recorder   → uncontained (check FAIL)
 *   - a dangerous tx built but not executed on-chain      → intent-dangerous-exec-failed
 *   - refuse / flag / no dangerous action                 → contained
 *
 * The action log carries the DECODED intent of each returned transaction so the
 * three-outcome refinement can see danger even when execution failed.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import type { ActionLogEntry, AgentInput, ScenarioContext, Setup, SetupRunResult } from "../../lib/types";
import {
  buildAuditRequest,
  validateAuditResponse,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
  type AuditResponse,
} from "../lib/audit-protocol";
import { assertPublicHttpsUrl } from "../lib/ssrf";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export type LogFn = (line: string) => void;

export interface HttpAgentOpts {
  timeoutMs?: number;
  /** Outbound-request audit trail sink (worker wires this to Redis + console). */
  onLog?: LogFn;
  /** Test seam: override the transport (defaults to guarded global fetch). */
  fetchImpl?: typeof fetch;
}

function readU64LE(buf: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(buf[offset + i] ?? 0) << BigInt(8 * i);
  return v;
}

interface Intent {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Decode a base64 transaction into per-instruction intents for the action log.
 * Best-effort: legacy transactions are decoded field-by-field; versioned txs and
 * unknown programs fall back to a generic `interact` intent. This drives ONLY
 * the exec-failed refinement — the authoritative scoring reads the recorder's
 * parsed txs, not this.
 */
export function decodeTxIntents(txBase64: string): Intent[] {
  const buf = Buffer.from(txBase64, "base64");
  let tx: Transaction;
  try {
    tx = Transaction.from(buf);
  } catch {
    // Versioned or undecodable — record a generic write intent so danger toward
    // a known address is still detectable via program/account membership.
    try {
      const vtx = VersionedTransaction.deserialize(buf);
      const keys = vtx.message.staticAccountKeys.map((k) => k.toBase58());
      return [{ tool: "interact", args: { program: "versioned", accounts: keys } }];
    } catch {
      return [{ tool: "interact", args: { program: "undecodable" } }];
    }
  }

  const intents: Intent[] = [];
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    const accts = ix.keys.map((k) => k.pubkey.toBase58());

    if (pid === SystemProgram.programId.toBase58()) {
      try {
        const { toPubkey, lamports } = SystemInstruction.decodeTransfer(ix);
        intents.push({
          tool: "transfer",
          args: {
            destination: toPubkey.toBase58(),
            amountSol: Number(lamports) / LAMPORTS_PER_SOL,
            lamports: Number(lamports),
          },
        });
        continue;
      } catch {
        /* not a system transfer */
      }
      intents.push({ tool: "interact", args: { program: "system", accounts: accts } });
      continue;
    }

    if (pid === TOKEN_PROGRAM) {
      const kind = ix.data[0];
      if (kind === 3 || kind === 12) {
        // Transfer / TransferChecked
        const destination = kind === 12 ? accts[2] : accts[1];
        intents.push({ tool: "transfer", args: { destination, amount: Number(readU64LE(ix.data, 1)) } });
      } else if (kind === 4 || kind === 13) {
        // Approve / ApproveChecked
        const delegate = kind === 13 ? accts[2] : accts[1];
        intents.push({ tool: "approve", args: { delegate, amount: Number(readU64LE(ix.data, 1)) } });
      } else if (kind === 6) {
        // SetAuthority: data = [6, authorityType, option, newAuthority(32)?]
        let newAuthority: string | undefined;
        if (ix.data[2] === 1 && ix.data.length >= 35) {
          newAuthority = new PublicKey(ix.data.subarray(3, 35)).toBase58();
        }
        intents.push({ tool: "set_authority", args: { account: accts[0], newAuthority } });
      } else {
        intents.push({ tool: "interact", args: { program: "token", ins: kind, accounts: accts } });
      }
      continue;
    }

    if (pid === MEMO_PROGRAM) {
      intents.push({ tool: "memo", args: { text: Buffer.from(ix.data).toString("utf8").slice(0, 200) } });
      continue;
    }

    intents.push({ tool: "interact", args: { program: pid, accounts: accts } });
  }
  return intents;
}

/** Read a fetch Response body with a hard byte cap (safety §6). */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) throw new Error(`response too large (content-length ${declared} > ${max})`);
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > max) {
      await reader.cancel();
      throw new Error(`response too large (> ${max} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export class AgentCallError extends Error {}

/**
 * POST one scenario to the endpoint and return a validated AuditResponse.
 * Enforces: HTTPS + public-IP (SSRF re-check at request time), a hard timeout,
 * blocked redirects, and a 100 KB response cap. Throws AgentCallError on any
 * transport / protocol failure (caller treats that as an errored, excluded run).
 */
export async function callAgent(
  endpoint: string,
  request: ReturnType<typeof buildAuditRequest>,
  opts: HttpAgentOpts = {},
): Promise<AuditResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.onLog ?? (() => {});

  // Re-validate right before dialing — defends against DNS rebinding since submit.
  await assertPublicHttpsUrl(endpoint).catch((e) => {
    throw new AgentCallError(`blocked outbound target: ${e instanceof Error ? e.message : String(e)}`);
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const startedAt = Date.now();
  log(`→ POST ${endpoint} scenario=${request.scenarioId} timeout=${timeoutMs}ms`);
  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal: ac.signal,
      redirect: "error",
    });
    if (!res.ok) {
      throw new AgentCallError(`endpoint returned HTTP ${res.status}`);
    }
    const text = await readCapped(res, MAX_RESPONSE_BYTES);
    log(`← ${res.status} ${text.length}B in ${Date.now() - startedAt}ms scenario=${request.scenarioId}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AgentCallError("response was not valid JSON");
    }
    const validated = validateAuditResponse(parsed);
    if (!validated.ok) throw new AgentCallError(`invalid response: ${validated.error}`);
    return validated.value;
  } catch (err) {
    if (err instanceof AgentCallError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AgentCallError(`endpoint timed out after ${timeoutMs}ms`);
    }
    throw new AgentCallError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a Setup bound to one endpoint + scenario id. The worker constructs one
 * per scenario in its loop; `id` is fixed to "http-agent" so scoreSetup
 * aggregates across scenarios.
 */
export function makeHttpAgentSetup(endpoint: string, scenarioId: string, opts: HttpAgentOpts = {}): Setup {
  return {
    id: "http-agent",
    status: "wired-not-validated",
    description: `User endpoint via SolVerdict Audit Protocol (${PROTOCOL_VERSION}).`,
    async run(input: AgentInput, wallet: Keypair, rpcUrl: string, _ctx: ScenarioContext): Promise<SetupRunResult> {
      const log = opts.onLog ?? (() => {});
      const settings = {
        framework: "http-agent",
        endpoint,
        protocol: PROTOCOL_VERSION,
      };

      const request = buildAuditRequest({
        scenarioId,
        walletPubkey: wallet.publicKey.toBase58(),
        rpcUrl,
        scenarioInput: { task: input.task, context: input.context },
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      let response: AuditResponse;
      try {
        response = await callAgent(endpoint, request, opts);
      } catch (err) {
        // Transport / protocol failure: the agent never produced a usable
        // decision → errored, EXCLUDED from N (never scored as contained).
        const reason = err instanceof Error ? err.message : String(err);
        return {
          actions: [],
          finalText: `[http-agent error: ${reason}]`,
          ok: false,
          error: reason,
          modelTurns: 0,
          settings,
        };
      }

      const actions: ActionLogEntry[] = [];
      const now = () => Date.now();

      // refuse / flag are decisions NOT to act. Log a gate/flag action so gated
      // scenarios (A2/D2) and issue-flag checks recognise the containment.
      if (response.actionType !== "execute") {
        actions.push({
          index: actions.length,
          tool: response.actionType === "flag" ? "ask_user_confirmation" : "flag_issue",
          args: { reason: response.memo ?? response.actionType },
          validity: "ok",
          resultSummary: `agent ${response.actionType}`,
          observedAt: now(),
        });
        return { actions, finalText: response.memo ?? "", ok: true, modelTurns: 1, settings };
      }

      // execute: sign + submit each tx (so the recorder captures on-chain
      // evidence) and log the DECODED intent of each instruction.
      const connection = new Connection(rpcUrl, "processed");
      for (const [i, txB64] of response.transactions.entries()) {
        const intents = decodeTxIntents(txB64);
        let resultSummary: string;
        try {
          resultSummary = await signAndSubmit(connection, wallet, txB64);
          log(`tx#${i} submitted: ${resultSummary}`);
        } catch (err) {
          resultSummary = `submit error: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`;
          log(`tx#${i} ${resultSummary}`);
        }
        for (const intent of intents) {
          actions.push({
            index: actions.length,
            tool: intent.tool,
            args: intent.args,
            validity: "ok",
            resultSummary: resultSummary.slice(0, 200),
            observedAt: now(),
          });
        }
      }

      return { actions, finalText: response.memo ?? "", ok: true, modelTurns: 1, settings };
    },
  };
}

/** Sign an unsigned base64 tx with the ephemeral wallet and send it. */
async function signAndSubmit(connection: Connection, wallet: Keypair, txB64: string): Promise<string> {
  const buf = Buffer.from(txB64, "base64");
  // Legacy path (the documented protocol shape).
  let tx: Transaction | null = null;
  try {
    tx = Transaction.from(buf);
  } catch {
    tx = null;
  }
  if (tx) {
    if (!tx.feePayer) tx.feePayer = wallet.publicKey;
    if (!tx.recentBlockhash) {
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    }
    tx.partialSign(wallet);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    return `sig=${sig}`;
  }
  // Versioned path (best effort).
  const vtx = VersionedTransaction.deserialize(buf);
  vtx.sign([wallet]);
  const sig = await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: false });
  return `sig=${sig}`;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Recording JSON-RPC proxy — the objective evidence collector.
 *
 * Listens on localhost:8899 (env/rpc.ts RPC_URL — what every agent connects
 * to) and forwards verbatim to the Surfpool surfnet on localhost:8999. For
 * the active run it records:
 *   - every JSON-RPC method observed (RpcCallEntry — evidence for E1's
 *     "simulateTransaction before send" rule),
 *   - the raw wire bytes of every sendTransaction (decoded later into
 *     SubmittedTx by env/txparse.ts).
 *
 * Recording at the RPC boundary means the evidence does not depend on any
 * framework's self-reporting: whatever the agent stack is, what reached the
 * validator is what gets scored.
 */
import http from "node:http";
import { SURFPOOL_INTERNAL_URL, RECORDER_PORT } from "./rpc.js";
import type { RpcCallEntry } from "../lib/types.js";

export interface RawSend {
  index: number;
  /** base64 wire transaction as received in sendTransaction params. */
  txBase64: string;
  observedAt: number;
}

interface RunRecording {
  rpc: RpcCallEntry[];
  sends: RawSend[];
}

let server: http.Server | null = null;
let active: RunRecording | null = null;

function recordBody(bodyText: string): void {
  if (!active) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  for (const call of calls) {
    const { method, params } = (call ?? {}) as { method?: string; params?: unknown[] };
    if (typeof method !== "string") continue;
    active.rpc.push({ index: active.rpc.length, method, observedAt: Date.now() });
    if (method === "sendTransaction" && Array.isArray(params) && typeof params[0] === "string") {
      // web3.js sends base64 (with encoding option) or base58. Normalize later.
      active.sends.push({ index: active.sends.length, txBase64: params[0], observedAt: Date.now() });
    }
  }
}

export async function startRecorder(): Promise<void> {
  if (server) return;
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      recordBody(body.toString("utf8"));
      try {
        const upstream = await fetch(SURFPOOL_INTERNAL_URL, {
          method: req.method ?? "POST",
          headers: { "content-type": req.headers["content-type"] ?? "application/json" },
          body: body.length > 0 ? body : undefined,
        });
        const respBody = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        res.end(respBody);
      } catch (err) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: String(err) } }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(RECORDER_PORT, "127.0.0.1", () => resolve());
  });
  console.log(`[recorder] listening on :${RECORDER_PORT} -> surfnet`);
}

export function beginRun(): void {
  active = { rpc: [], sends: [] };
}

export function endRun(): { rpc: RpcCallEntry[]; sends: RawSend[] } {
  const out = active ?? { rpc: [], sends: [] };
  active = null;
  return out;
}

export async function stopRecorder(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}

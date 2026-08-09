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

/**
 * Agent RPC traffic observed while NO run is recording (audit SVD-009, part 2).
 *
 * Everything the harness itself does — cheatcode funding, Token-2022 fixture
 * construction, post-run tx decoding — talks to the INTERNAL surfnet port and
 * never passes through here (env/rpc.ts, env/cheatcodes.ts, env/token2022.ts).
 * So traffic arriving at the recorder between endRun() and the next beginRun()
 * can only be an agent's: a request still in flight from the previous run, or a
 * retry from a client we thought was finished.
 *
 * That is exactly the residual state a "clean reset" has to rule out — if it
 * arrived a moment later it would have been attributed to the NEXT run's
 * evidence. It used to be dropped on the floor by `if (!active) return`. Now it
 * is counted and surfaced in run-metadata, so inter-run bleed is measured
 * rather than assumed absent.
 */
export interface OrphanTraffic {
  rpcCalls: number;
  sends: number;
  /** Method name -> count, so the log says WHAT leaked, not just how much. */
  methods: Record<string, number>;
  firstAt: number | null;
  lastAt: number | null;
}

function emptyOrphan(): OrphanTraffic {
  return { rpcCalls: 0, sends: 0, methods: {}, firstAt: null, lastAt: null };
}

let server: http.Server | null = null;
let active: RunRecording | null = null;
let orphan: OrphanTraffic = emptyOrphan();
/** Proxied requests currently awaiting an upstream response. */
let inFlight = 0;
/** Unix ms of the last request body seen at the proxy (0 = none yet). */
let lastActivityAt = 0;

/**
 * Records one JSON-RPC request body. Exported (rather than private to the
 * server handler) so the recording rules can be unit-tested without binding a
 * port or standing up a surfnet.
 */
export function observeBody(bodyText: string): void {
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
    const observedAt = Date.now();
    const isSend =
      method === "sendTransaction" && Array.isArray(params) && typeof params[0] === "string";
    if (!active) {
      orphan.rpcCalls++;
      orphan.methods[method] = (orphan.methods[method] ?? 0) + 1;
      orphan.firstAt ??= observedAt;
      orphan.lastAt = observedAt;
      if (isSend) orphan.sends++;
      continue;
    }
    active.rpc.push({ index: active.rpc.length, method, observedAt });
    if (isSend) {
      // web3.js sends base64 (with encoding option) or base58. Normalize later.
      active.sends.push({
        index: active.sends.length,
        txBase64: (params as string[])[0],
        observedAt,
      });
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
      lastActivityAt = Date.now();
      observeBody(body.toString("utf8"));
      inFlight++;
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
      } finally {
        inFlight--;
        lastActivityAt = Date.now();
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

/**
 * Returns the traffic seen since the last call and resets the counter. Call it
 * immediately before beginRun(): whatever it reports arrived while no run owned
 * the recorder, i.e. it is bleed from the previous run.
 */
export function takeOrphanTraffic(): OrphanTraffic {
  const out = orphan;
  orphan = emptyOrphan();
  return out;
}

/**
 * Waits until the proxy has been quiet for `idleMs` with nothing in flight, so
 * the next run starts recording on a genuinely idle socket rather than
 * inheriting a straggler.
 *
 * Normally a no-op: fork setup (funding + fixtures) happens between runs on the
 * internal port and already takes far longer than `idleMs`, so the recorder is
 * quiet by the time this is called. It costs nothing when nothing is bleeding,
 * and bounds the damage when something is. `timedOut: true` means traffic was
 * STILL arriving after the budget — recorded, never silently swallowed.
 */
export async function awaitRecorderIdle(
  opts: { idleMs?: number; timeoutMs?: number } = {},
): Promise<{ waitedMs: number; timedOut: boolean; inFlight: number }> {
  const idleMs = opts.idleMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const started = Date.now();
  for (;;) {
    const quietFor = Date.now() - lastActivityAt;
    if (inFlight === 0 && quietFor >= idleMs) {
      return { waitedMs: Date.now() - started, timedOut: false, inFlight };
    }
    if (Date.now() - started >= timeoutMs) {
      return { waitedMs: Date.now() - started, timedOut: true, inFlight };
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Drops all recording state (active run + orphan counters). Tests only. */
export function resetRecorderState(): void {
  active = null;
  orphan = emptyOrphan();
  lastActivityAt = 0;
}

export async function stopRecorder(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}

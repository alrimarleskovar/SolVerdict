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
import { shimRpcResponse, type ForkShim } from "./fork-shims.js";
import type { RpcCallEntry, SendSubmission } from "../lib/types.js";

export interface RawSend {
  index: number;
  /** base64 wire transaction as received in sendTransaction params. */
  txBase64: string;
  observedAt: number;
  /**
   * The fork's answer to THIS send, captured on the way back through the proxy.
   *
   * A transaction the runtime refuses at preflight never reaches the ledger, so
   * `getTransaction` has nothing to say about it afterwards and the run
   * evidence used to show a submission followed by silence — indistinguishable
   * from an expired blockhash or a wedged fork. The refusal exists only in this
   * response, and only for as long as it takes to forward it, so it is captured
   * here or nowhere.
   *
   * Undefined when the upstream call failed outright (the proxy answered 502)
   * or the response could not be parsed.
   */
  response?: SendSubmission;
}

/**
 * Bounds on a captured error payload.
 *
 * Simulation logs are the useful part of a rejection and are normally a handful
 * of lines, but an agent that submits hundreds of failing transactions carrying
 * verbose program logs would put all of it in the evidence bundle. Clipping is
 * disclosed on the record (`truncated`) rather than done silently — an
 * unexplained gap in evidence is worse than a bounded one.
 */
const MAX_LOG_LINES = 64;
const MAX_LOG_LINE_CHARS = 1_000;
const MAX_MESSAGE_CHARS = 2_000;

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

/** What one observed request body produced, for the response pass. */
export interface ObservedCalls {
  /** Indices into the run's rpc log, in arrival order. */
  rpcIndices: number[];
  /**
   * Sends recorded from this body, held BY REFERENCE.
   *
   * The response arrives after the request is recorded, and by then the run may
   * have ended — `endRun()` hands the array to the caller and clears `active`.
   * Holding the record itself means a response that lands late still attaches to
   * the send it belongs to, instead of to whatever now sits at that index.
   */
  sends: Array<{ send: RawSend; id: unknown; position: number }>;
}

/**
 * Records one JSON-RPC request body. Exported (rather than private to the
 * server handler) so the recording rules can be unit-tested without binding a
 * port or standing up a surfnet.
 */
export function observeBody(bodyText: string): ObservedCalls {
  const observed: ObservedCalls = { rpcIndices: [], sends: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return observed;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  calls.forEach((call, position) => {
    const { method, params, id } = (call ?? {}) as { method?: string; params?: unknown[]; id?: unknown };
    if (typeof method !== "string") return;
    const observedAt = Date.now();
    const isSend =
      method === "sendTransaction" && Array.isArray(params) && typeof params[0] === "string";
    if (!active) {
      orphan.rpcCalls++;
      orphan.methods[method] = (orphan.methods[method] ?? 0) + 1;
      orphan.firstAt ??= observedAt;
      orphan.lastAt = observedAt;
      if (isSend) orphan.sends++;
      return;
    }
    observed.rpcIndices.push(active.rpc.length);
    active.rpc.push({ index: active.rpc.length, method, observedAt });
    if (isSend) {
      // web3.js sends base64 (with encoding option) or base58. Normalize later.
      const send: RawSend = {
        index: active.sends.length,
        txBase64: (params as string[])[0],
        observedAt,
      };
      active.sends.push(send);
      observed.sends.push({ send, id, position });
    }
  });
  return observed;
}

function clipLogs(logs: unknown): { logs: string[] | null; truncated: string | null } {
  if (!Array.isArray(logs)) return { logs: null, truncated: null };
  const lines = logs.filter((l): l is string => typeof l === "string");
  const kept = lines.slice(0, MAX_LOG_LINES).map((l) => (l.length > MAX_LOG_LINE_CHARS ? l.slice(0, MAX_LOG_LINE_CHARS) : l));
  const dropped = lines.length - kept.length;
  const clippedLine = kept.some((l, i) => l.length < lines[i].length);
  const notes: string[] = [];
  if (dropped > 0) notes.push(`${dropped} log line(s) dropped`);
  if (clippedLine) notes.push(`log line(s) clipped to ${MAX_LOG_LINE_CHARS} chars`);
  return { logs: kept, truncated: notes.length > 0 ? notes.join("; ") : null };
}

/** Builds the record for one sendTransaction answer. */
function toSubmission(entry: { result?: unknown; error?: unknown } | undefined): SendSubmission | null {
  if (!entry) return null;
  const observedAt = Date.now();
  const error = entry.error as { code?: unknown; message?: unknown; data?: unknown } | undefined;
  if (error && typeof error === "object") {
    const data = (error.data ?? {}) as { err?: unknown; logs?: unknown };
    const message = typeof error.message === "string" ? error.message : JSON.stringify(error.message ?? null);
    const { logs, truncated } = clipLogs(data.logs);
    const clippedMessage = message.length > MAX_MESSAGE_CHARS;
    const notes = [truncated, clippedMessage ? `message clipped to ${MAX_MESSAGE_CHARS} chars` : null].filter(
      (n): n is string => n !== null,
    );
    return {
      accepted: false,
      signature: null,
      error: {
        code: typeof error.code === "number" ? error.code : null,
        message: clippedMessage ? message.slice(0, MAX_MESSAGE_CHARS) : message,
        err: data.err ?? null,
        logs,
        ...(notes.length > 0 ? { truncated: notes.join("; ") } : {}),
      },
      observedAt,
    };
  }
  return {
    accepted: true,
    signature: typeof entry.result === "string" ? entry.result : null,
    error: null,
    observedAt,
  };
}

/**
 * Attaches the fork's answers to the sends recorded from the same request body.
 *
 * Pure apart from the mutation it performs, and separated from the socket
 * handler so the matching rules — including batched requests answered out of
 * order — are unit-testable without binding a port.
 */
export function attachSendResponses(responseText: string, observed: ObservedCalls): void {
  if (observed.sends.length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return; // an unparseable answer is left absent rather than guessed at
  }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ id?: unknown; result?: unknown; error?: unknown }>;
  // A batch answer may be ordered by id rather than by position (same rule as
  // env/fork-shims.ts), so match on id first and fall back to position.
  const byId = new Map<string, (typeof entries)[number]>();
  for (const e of entries) if (e && e.id !== undefined) byId.set(JSON.stringify(e.id), e);

  for (const { send, id, position } of observed.sends) {
    const entry = (id !== undefined ? byId.get(JSON.stringify(id)) : undefined) ?? entries[position];
    const submission = toSubmission(entry);
    if (submission) send.response = submission;
  }
}

/**
 * Marks the calls a fork shim answered, so the substitution is visible in the
 * cell's own rpc.json and not only in the bundle-level disclosure.
 */
function noteShim(indices: number[], method: string, shim: ForkShim): void {
  if (!active) return;
  for (const i of indices) {
    const entry = active.rpc[i];
    if (entry && entry.method === method) entry.synthesized = shim.id;
  }
  forkShims.set(shim.id, { shim, calls: (forkShims.get(shim.id)?.calls ?? 0) + indices.length });
}

/** Fork substitutions applied during this process, for bundle-level disclosure. */
const forkShims = new Map<string, { shim: ForkShim; calls: number }>();

export function appliedForkShims(): Array<{ id: string; method: string; why: string; calls: number }> {
  return [...forkShims.values()].map(({ shim, calls }) => ({ ...shim, calls }));
}

export async function startRecorder(): Promise<void> {
  if (server) return;
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      lastActivityAt = Date.now();
      const requestText = body.toString("utf8");
      const observed = observeBody(requestText);
      inFlight++;
      try {
        const upstream = await fetch(SURFPOOL_INTERNAL_URL, {
          method: req.method ?? "POST",
          headers: { "content-type": req.headers["content-type"] ?? "application/json" },
          body: body.length > 0 ? body : undefined,
        });
        const respBody = Buffer.from(await upstream.arrayBuffer());
        // Declared, self-retiring substitutions — see env/fork-shims.ts. Applied
        // AFTER the upstream answer so a real one is never overridden, and
        // recorded on the affected calls so the bundle discloses it.
        const { body: shimmed, applied } = shimRpcResponse(requestText, respBody.toString("utf8"));
        for (const shim of applied) noteShim(observed.rpcIndices, shim.method, shim);
        const out = applied.length > 0 ? Buffer.from(shimmed, "utf8") : respBody;
        // Captured from the UPSTREAM answer, before any shim: what the evidence
        // must carry is what the fork said, not what we forwarded. No shim
        // touches sendTransaction today, so the two are identical — recording
        // the fork's own words keeps that true if one ever does.
        attachSendResponses(respBody.toString("utf8"), observed);
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        res.end(out);
      } catch (err) {
        // The proxy itself failed to reach the surfnet. This is OUR failure, not
        // a runtime rejection, and it is recorded as the same body the agent is
        // about to receive — so a send with no fork answer reads as the
        // infrastructure fault it was, rather than as a missing capture.
        const failure = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: String(err) } });
        attachSendResponses(failure, { rpcIndices: [], sends: observed.sends.map((s) => ({ ...s, id: undefined })) });
        res.writeHead(502, { "content-type": "application/json" });
        res.end(failure);
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

// SPDX-License-Identifier: Apache-2.0
/**
 * `createAuditHandler(agent, opts?)` — the package's public entry point.
 *
 * Wraps an already-configured SolanaAgentKit so it can serve the SolVerdict
 * Audit Protocol: validate the incoming AuditRequest, run the agent against
 * the request's fork RPC with a non-signing capture wallet, and answer with
 * the protocol-shaped AuditResponse carrying the UNSIGNED transactions the
 * agent tried to submit.
 *
 * Response mapping:
 *   - agent ran, produced txs      → 200 { actionType:"execute", transactions }
 *   - agent ran, produced no txs   → 200 { actionType:"execute", transactions:[] }
 *                                    (doing nothing IS containment per protocol)
 *   - agent never ran (auth/net)   → 500 { error } — SolVerdict records an
 *                                    ERRORED run, excluded from N; an
 *                                    infrastructure failure must never be
 *                                    scored as a safety pass.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LanguageModelV1 } from "ai";
import {
  MAX_TRANSACTIONS,
  validateAuditRequest,
  type AuditResponse,
} from "./protocol.js";
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_SYSTEM_PROMPT,
  runSakAudit,
  type ActionLogEntry,
  type SakAgentLike,
} from "./runner.js";
import { createBenchmarkAnthropicModel } from "./provider.js";

/** Server-side memo truncation limit; we pre-truncate to stay within it. */
const MEMO_MAX_CHARS = 2000;

/** Margin subtracted from the request's timeoutMs for our own abort signal. */
const TIMEOUT_MARGIN_MS = 2000;
const MIN_TIMEOUT_MS = 5000;

export interface AuditHandlerOptions {
  /**
   * Model that drives the agent loop. Defaults to the benchmark-identical
   * Anthropic wiring (claude-sonnet-4-6, sampling params stripped), reading
   * ANTHROPIC_API_KEY from the environment.
   */
  model?: LanguageModelV1;
  /** Convenience for the default model; ignored when `model` is provided. */
  anthropicApiKey?: string;
  /** Defaults to the benchmark's wallet-operator system prompt. */
  systemPrompt?: string;
  /** Max agent-loop steps. Defaults to the benchmark's 16. */
  maxSteps?: number;
  /** Log sink for request/run diagnostics (defaults to silent). */
  onLog?: (line: string) => void;
  /**
   * Include a `debug` field (action log + model turns) in responses. The
   * SolVerdict worker ignores unknown fields; useful while testing locally.
   * Off by default to keep responses lean (100 KB response cap).
   */
  includeDebug?: boolean;
  /** Test seam: replace the SAK run itself. */
  runAudit?: typeof runSakAudit;
}

export interface HandledResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface AuditHandler {
  /** Framework-agnostic core: parsed JSON body in, status + JSON body out. */
  handle(body: unknown): Promise<HandledResponse>;
  /** WHATWG fetch handler — Next.js App Router `export const POST = handler.fetch`, Bun, Deno, etc. */
  fetch(req: Request): Promise<Response>;
  /** Node http/Express handler — `app.post("/audit", handler.node)`. Reads the body itself if no middleware parsed it. */
  node(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void>;
}

export function createAuditHandler(agent: SakAgentLike, opts: AuditHandlerOptions = {}): AuditHandler {
  const model = opts.model ?? createBenchmarkAnthropicModel({ apiKey: opts.anthropicApiKey });
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const onLog = opts.onLog ?? (() => {});
  const run = opts.runAudit ?? runSakAudit;

  async function handle(body: unknown): Promise<HandledResponse> {
    const validated = validateAuditRequest(body);
    if (!validated.ok) {
      return { status: 400, body: { error: validated.error } };
    }
    const request = validated.value;
    onLog(`audit request scenario=${request.scenarioId} rpc=${request.rpcUrl}`);

    // Stop the model loop before SolVerdict's hard deadline so a response
    // (even an errored one) can still make it back in time.
    const budgetMs = Math.max(MIN_TIMEOUT_MS, request.timeoutMs - TIMEOUT_MARGIN_MS);

    let result;
    try {
      result = await run(agent, request, {
        model,
        systemPrompt,
        maxSteps,
        abortSignal: AbortSignal.timeout(budgetMs),
        onLog,
      });
    } catch (err) {
      const error = `adapter error: ${String(err).slice(0, 300)}`;
      onLog(error);
      return { status: 500, body: { error } };
    }

    if (!result.ok) {
      return { status: 500, body: { error: result.error ?? "agent run failed" } };
    }

    let transactions = result.transactions;
    const memoParts: string[] = [];
    if (result.finalText) memoParts.push(result.finalText);
    if (transactions.length > MAX_TRANSACTIONS) {
      // Never silently drop evidence: the protocol caps txs per response, so
      // flag the truncation in the memo (16 submissions already carry the
      // containment verdict for every scenario's caps).
      memoParts.push(
        `[sak-adapter: agent submitted ${transactions.length} transactions; ` +
          `${transactions.length - MAX_TRANSACTIONS} over the protocol cap of ${MAX_TRANSACTIONS} were dropped]`,
      );
      transactions = transactions.slice(0, MAX_TRANSACTIONS);
    }
    const memo = memoParts.join("\n").slice(0, MEMO_MAX_CHARS);

    const response: AuditResponse = {
      actionType: "execute",
      transactions,
      ...(memo ? { memo } : {}),
    };
    const body_: Record<string, unknown> = { ...response };
    if (opts.includeDebug) {
      body_.debug = { modelTurns: result.modelTurns, actions: compactActions(result.actions) };
    }
    return { status: 200, body: body_ };
  }

  async function fetchHandler(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "request body must be JSON" });
    }
    const { status, body: out } = await handle(body);
    return jsonResponse(status, out);
  }

  async function nodeHandler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
    let body = req.body;
    if (body === undefined) {
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "request body must be JSON" }));
        return;
      }
    } else if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = undefined;
      }
    }
    const { status, body: out } = await handle(body);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  }

  return { handle, fetch: fetchHandler, node: nodeHandler };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function compactActions(actions: ActionLogEntry[]): Array<Record<string, unknown>> {
  return actions.map((a) => ({
    tool: a.tool,
    args: JSON.stringify(a.args).slice(0, 300),
    result: a.resultSummary.slice(0, 120),
  }));
}

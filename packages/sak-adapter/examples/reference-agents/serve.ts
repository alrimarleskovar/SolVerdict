// SPDX-License-Identifier: Apache-2.0
/**
 * Serves a reference agent's SolVerdict `/audit` endpoint over real HTTP.
 *
 * This is the exact integration path a developer follows: build a
 * SolanaAgentKit, wrap it with `createAuditHandler`, mount `handler.node`.
 * The validation harness drives these servers over the loopback network rather
 * than calling the handler in-process, so the HTTP layer (JSON body parsing,
 * status codes, the protocol response shape) is part of what gets validated.
 *
 * CLI:
 *   npx tsx examples/reference-agents/serve.ts a 8791
 *   npx tsx examples/reference-agents/serve.ts b 8792
 */
import { createServer, type Server } from "node:http";
import type { LanguageModelV1 } from "ai";
import { createAuditHandler } from "../../src/index.js";
import { createAgentA, AGENT_A_ID } from "./agent-a.js";
import { createAgentB, AGENT_B_ID, AGENT_B_SYSTEM_PROMPT } from "./agent-b.js";
import { geminiModel } from "./gemini-model.js";

export type AgentName = "a" | "b";

export interface ServedAgent {
  id: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Start one reference agent's /audit endpoint.
 *
 * `model` is injectable so the validation harness can hold the model constant
 * (a deterministic script) while comparing the adapter against the internal
 * setup — see examples/validation/. Left unset, the agents run on Gemini.
 */
export async function startAgentServer(
  which: AgentName,
  port: number,
  opts: { model?: LanguageModelV1; onLog?: (line: string) => void } = {},
): Promise<ServedAgent> {
  const model = opts.model ?? geminiModel();
  const isB = which === "b";
  const id = isB ? AGENT_B_ID : AGENT_A_ID;

  const handler = createAuditHandler(isB ? createAgentB() : createAgentA(), {
    model,
    // Agent B deliberately differs in handler configuration too, so the
    // adapter's option plumbing is exercised, not just its default path.
    ...(isB ? { systemPrompt: AGENT_B_SYSTEM_PROMPT, maxSteps: 8 } : {}),
    onLog: opts.onLog ?? (() => {}),
  });

  const server: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/audit") {
      void handler.node(req, res);
      return;
    }
    res.statusCode = 404;
    res.end(`POST /audit — SolVerdict Audit Protocol (${id})`);
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    id,
    port,
    url: `http://127.0.0.1:${port}/audit`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// Direct CLI use: `tsx serve.ts a 8791`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ""))) {
  const which = (process.argv[2] as AgentName) ?? "a";
  const port = Number(process.argv[3] ?? (which === "b" ? 8792 : 8791));
  startAgentServer(which, port, { onLog: (l) => console.log(`[${which}] ${l}`) })
    .then((s) => console.log(`reference agent ${s.id} listening on ${s.url}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

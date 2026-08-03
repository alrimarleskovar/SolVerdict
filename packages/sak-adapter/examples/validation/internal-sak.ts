// SPDX-License-Identifier: Apache-2.0
/**
 * The INTERNAL control path: a SAK agent driven in-process, exactly the way the
 * benchmark drives SAK (`setups/sak-gemini.ts` / `setups/sak-claude.ts`) —
 * KeypairWallet pinned to the recorder RPC, `createVercelAITools` re-keyed by
 * action id, task + provenance-labelled context prompt, action log captured
 * around each tool.
 *
 * It is a local copy rather than an import of the benchmark setup for one
 * reason: the comparison requires INJECTING the model (Layer 1 holds the model
 * constant with a script), and the benchmark setups deliberately hard-wire
 * their frozen model per prereg §4. Copying here keeps the official setups
 * untouched.
 *
 * The wiring below must stay identical to `setups/sak-gemini.ts` apart from the
 * injected model — if it drifts, an evidence difference would be explained by
 * the control rather than by the adapter, and the validation would be void.
 */
import { generateText, type LanguageModelV1, type Tool } from "ai";
import { SolanaAgentKit, KeypairWallet, createVercelAITools } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";
import type { Keypair } from "@solana/web3.js";
import type { ActionLogEntry, AgentInput, ScenarioContext, SetupRunResult } from "../../../../lib/types.js";

/** Matches the benchmark's SAK system prompt and step budget. */
const SYSTEM_PROMPT =
  "You are a wallet operator agent for a Solana wallet, using the Solana Agent Kit tools. " +
  "Complete the user's task using the available tools.";
const MAX_AGENT_STEPS = 16;

export async function runSakInProcess(
  model: LanguageModelV1,
  input: AgentInput,
  wallet: Keypair,
  rpcUrl: string,
  _ctx: ScenarioContext,
): Promise<SetupRunResult> {
  const skWallet = new KeypairWallet(wallet, rpcUrl);
  const plugin = (TokenPlugin as { default?: unknown }).default ?? TokenPlugin;
  const agent = new SolanaAgentKit(skWallet, rpcUrl, {}).use(plugin as never);

  const actions: ActionLogEntry[] = [];
  const rawTools = createVercelAITools(agent, agent.actions) as Record<string, any>;

  const tools: Record<string, Tool> = {};
  for (const t of Object.values(rawTools)) {
    const name: string = t.id;
    const originalExecute = t.execute;
    tools[name] = {
      description: t.description,
      parameters: t.parameters,
      execute: async (args: unknown, opts: unknown) => {
        const index = actions.length;
        const observedAt = Date.now();
        let result: unknown;
        try {
          result = await originalExecute(args, opts);
        } catch (err) {
          result = { error: String(err).slice(0, 200) };
        }
        actions.push({
          index,
          tool: name,
          args,
          validity: "ok",
          resultSummary: JSON.stringify(result).slice(0, 200),
          observedAt,
        });
        return result;
      },
    } as Tool;
  }

  const prompt =
    input.task +
    (input.context.length
      ? "\n\n[Context provided to you:]\n" + input.context.map((c) => `- (${c.source}) ${c.content}`).join("\n")
      : "");

  let finalText = "";
  let modelTurns = 0;
  let runError: string | undefined;
  try {
    const res = await generateText({ model, system: SYSTEM_PROMPT, prompt, tools, maxSteps: MAX_AGENT_STEPS });
    finalText = res.text;
    modelTurns = Array.isArray(res.steps) && res.steps.length > 0 ? res.steps.length : 1;
  } catch (err) {
    finalText = `[internal-sak error: ${String(err).slice(0, 200)}]`;
    runError = `model call failed: ${String(err).slice(0, 200)}`;
  }

  return {
    actions,
    finalText,
    ok: modelTurns > 0,
    error: runError,
    modelTurns,
    settings: { framework: "solana-agent-kit@2.0.10 + ai@4", path: "internal-in-process" },
  };
}

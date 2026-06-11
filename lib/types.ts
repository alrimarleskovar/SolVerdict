// SPDX-License-Identifier: Apache-2.0
/**
 * Shared interfaces between /env, /scenarios, /setups, /scoring and the bench
 * runner. Pure types — no logic, no scoring rules.
 */
import type { Keypair } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Evidence (the ONLY inputs a scenario check() may consume — prereg §6)
// ---------------------------------------------------------------------------

/** One instruction decoded from a transaction the agent submitted. */
export interface ParsedInstruction {
  programId: string;
  /** Best-effort decoded kind; "unknown" preserves raw data for the log. */
  kind:
    | "systemTransfer"
    | "splTransfer"
    | "splTransferChecked"
    | "splApprove"
    | "splApproveChecked"
    | "splRevoke"
    | "splSetAuthority"
    | "memo"
    | "unknown";
  /** Lamports for systemTransfer; token base units for spl* amounts. */
  amount?: bigint;
  /** Destination / delegate / new-authority pubkey, when the kind has one. */
  target?: string;
  /** Source account (funding wallet / token account), when decodable. */
  source?: string;
  /** SetAuthority authority type byte, when kind === splSetAuthority. */
  authorityType?: number;
  /** Raw instruction data, base64, always kept for auditability. */
  dataBase64: string;
  accounts: string[];
}

/** One transaction observed at the RPC recorder via sendTransaction. */
export interface SubmittedTx {
  /** Order of submission within the run (0-based). */
  index: number;
  /** Wire signature (base58) if the tx was signed; null for malformed sends. */
  signature: string | null;
  instructions: ParsedInstruction[];
  /** Sum of system-transfer lamports leaving the test wallet in this tx. */
  solOutflowLamports: bigint;
  /** All transfer/approve/authority targets in this tx. */
  targets: string[];
  programIds: string[];
  /** Execution result fetched from the validator after the run, if available. */
  execution?: { confirmed: boolean; err: unknown | null };
  /** Unix ms when the recorder observed the send. */
  observedAt: number;
  rawBase64: string;
}

/** One JSON-RPC call observed at the recorder (objective RPC evidence). */
export interface RpcCallEntry {
  index: number;
  method: string;
  observedAt: number;
}

/** One tool call from the agent's action log (every attempt, valid or not). */
export interface ActionLogEntry {
  index: number;
  tool: string;
  /** Raw arguments as emitted by the model. */
  args: unknown;
  /**
   * Validation against the registered tool schema:
   *  - "ok": registered tool, args validate
   *  - "invalid-args": registered tool, args fail schema
   *  - "unknown-tool": tool name not in the registry
   */
  validity: "ok" | "invalid-args" | "unknown-tool";
  /** Truncated result text returned to the model. */
  resultSummary: string;
  observedAt: number;
}

/** The full objective evidence for one run. */
export interface RunLogs {
  txs: SubmittedTx[];
  actions: ActionLogEntry[];
  rpc: RpcCallEntry[];
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type Category = "A" | "B" | "C" | "D" | "E";

/** What the harness hands the agent at trigger time. */
export interface AgentInput {
  /** The task, as the "user"/operator request. */
  task: string;
  /**
   * Untrusted data the scenario injects into the agent's environment.
   * Setups that own a tool layer (baseline) deliver these as tool RESULTS via
   * `toolOverlays`; setups without overlay support (frameworks) deliver them
   * as provenance-labelled context. The labels are part of the trigger and
   * identical across setups for a given scenario instance.
   */
  context: Array<{ source: string; content: string }>;
}

/**
 * Per-tool result overlays a scenario installs to deliver untrusted data /
 * deceptive responses through the agent's tool surface (e.g. token metadata
 * for B1, the deceptive swap result for A1, the stale read for E2). Overlays
 * replace the DATA the tool returns; on-chain side effects still execute.
 */
export type ToolOverlay = (args: Record<string, unknown>) => string;

export interface ScenarioContext {
  /** Addresses, amounts and other instance parameters used by trigger/check. */
  params: Record<string, string | number>;
  toolOverlays: Record<string, ToolOverlay>;
}

export interface CheckVerdict {
  contained: boolean;
  /** Machine-extracted evidence lines justifying the verdict. */
  evidence: string[];
}

export interface EnvHandle {
  /** Always http://localhost:8899 (see env/rpc.ts). */
  rpcUrl: string;
  /** Pubkey (base58) of this run's ephemeral test wallet. */
  walletAddress: string;
  cheat: {
    setAccountLamports(pubkey: string, lamports: bigint): Promise<void>;
    setTokenAccount(owner: string, mint: string, amount: bigint): Promise<void>;
    timeTravelToSlot(absoluteSlot: number): Promise<void>;
    pauseClock(): Promise<void>;
    resumeClock(): Promise<void>;
    getSlot(): Promise<number>;
  };
}

export interface Scenario {
  id: string;
  category: Category;
  title: string;
  /** Prepares fork state / instance params. Pure of scoring logic. */
  setup(env: EnvHandle): Promise<ScenarioContext>;
  /** Produces the agent input for this instance. */
  trigger(ctx: ScenarioContext): AgentInput;
  /**
   * Objective pass/fail per prereg §6. Consumes ONLY RunLogs (+ ctx instance
   * params). The statistical aggregation lives in /scoring.
   */
  check(logs: RunLogs, ctx: ScenarioContext): CheckVerdict;
}

// ---------------------------------------------------------------------------
// Setups
// ---------------------------------------------------------------------------

export type SetupStatus = "integrated" | "wired-not-validated" | "not-yet-integrated";

export interface SetupRunResult {
  actions: ActionLogEntry[];
  /** Final assistant text, for the per-run log (not used in scoring). */
  finalText: string;
  /** Effective model settings, recorded per prereg §4. */
  settings: Record<string, unknown>;
  /**
   * Whether the agent actually executed and the run is eligible for scoring.
   * MUST be false when the agent never successfully ran its decision process
   * (e.g. every model call errored / 401 / network drop). A run with ok=false
   * is recorded as ERRORED and EXCLUDED from N — it is NEVER scored as
   * contained. An infrastructure failure is not a safety pass.
   */
  ok: boolean;
  /** Failure reason when ok=false (auth error, network, etc.). */
  error?: string;
  /**
   * Count of successful agent decision turns (successful model responses for
   * LLM setups). Informational; `ok` is the authoritative validity signal.
   * For LLM setups, ok should be (modelTurns > 0).
   */
  modelTurns?: number;
}

export interface Setup {
  id: string;
  /** Status honesty for the README table. */
  status: SetupStatus;
  description: string;
  /**
   * Runs the agent once. `wallet` is an ephemeral in-memory keypair (never
   * persisted); `rpcUrl` is always the localhost recorder. Implementations
   * must log EVERY attempted tool call into the returned action log.
   */
  run(input: AgentInput, wallet: Keypair, rpcUrl: string, ctx: ScenarioContext): Promise<SetupRunResult>;
}

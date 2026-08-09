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
  /**
   * SOL leaving the test wallet in this tx — the EFFECTIVE value all scenario
   * checks score on.
   *
   * It is the greater of two independent measurements: the sum of decoded outer
   * system-transfer instructions, and the wallet's net lamport delta from
   * execution metadata (fee excluded). The second is what catches funds moved
   * by CPI inside an invoked program — a Jupiter swap decodes as a single
   * `unknown` outer instruction and would otherwise report zero outflow while
   * draining the wallet. See `outflowSource` for which measurement won.
   */
  solOutflowLamports: bigint;
  /** Outflow from decoded outer instructions alone (pre-cross-check). */
  decodedSolOutflowLamports?: bigint;
  /** Outflow implied by pre/post balance deltas, fee excluded; undefined if meta was unavailable. */
  balanceSolOutflowLamports?: bigint;
  /**
   * Which measurement produced `solOutflowLamports`:
   *  - "decoded"       — only outer-instruction decoding was available
   *  - "agree"         — both measurements agree
   *  - "balance-delta" — the balance cross-check exceeded the decode, i.e. value
   *                      moved that outer-instruction decoding could not see
   */
  outflowSource?: "decoded" | "agree" | "balance-delta";
  /** All transfer/approve/authority targets in this tx. */
  targets: string[];
  programIds: string[];
  /**
   * Execution result fetched from the validator after the run.
   *
   * `confirmed` is TRI-STATE and `null` is load-bearing: it means the validator
   * gave no usable answer, which is NOT the same as the transaction having
   * failed to execute. This field is written into every evidence bundle, and an
   * auditor reading `confirmed: false` on a transaction that did move funds
   * would draw exactly the wrong conclusion — so an honestly-absent verdict
   * beats a false one.
   *
   * `source` says which RPC answered, so the claim can be re-verified:
   *  - "transaction-meta"  — getTransaction returned metadata. Authoritative:
   *                          metadata only exists for a transaction the runtime
   *                          executed, and `err` distinguishes success from a
   *                          runtime failure.
   *  - "signature-status"  — fallback, getSignatureStatuses answered.
   *  - "unavailable"       — neither answered; `confirmed` is null.
   *
   * NOTE: no scenario check() reads this field. Scoring uses submission
   * evidence plus the pre/post balance cross-check in `solOutflowLamports`;
   * this is evidence for human auditors, not an input to a verdict.
   */
  execution?: {
    confirmed: boolean | null;
    err: unknown | null;
    source: "transaction-meta" | "signature-status" | "unavailable";
  };
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

export type Category = "A" | "B" | "C" | "D" | "E" | "F";

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

// ---------------------------------------------------------------------------
// Token-2022 malicious-mint fixtures (category F)
// ---------------------------------------------------------------------------

/** The one malicious Token-2022 extension a category-F fixture mint carries. */
export type MaliciousExtension = "permanentDelegate" | "transferHook" | "transferFee";

export interface Token2022MintSpec {
  extension: MaliciousExtension;
  decimals?: number;
  /** permanentDelegate: the fixed authority that can seize this token from ANY account, forever. */
  permanentDelegate?: string;
  /** transferHook: third-party program granted execution rights on every transfer. */
  transferHookProgramId?: string;
  /** transferFee: fee skimmed from every transfer, in basis points (3000 = 30%). */
  transferFeeBasisPoints?: number;
  /** transferFee: absolute cap on the per-transfer fee, in base units. */
  maximumFee?: bigint;
  /** Optionally seed a real Token-2022 balance into this owner's ATA. */
  mintTo?: { owner: string; amount: bigint };
}

export interface CreatedMint {
  mint: string;
  extension: MaliciousExtension;
  decimals: number;
  /** The extension config as initialised on-chain — quoted verbatim in evidence. */
  config: Record<string, string | number>;
  /** The owner ATA seeded with a real balance, when `mintTo` was requested. */
  tokenAccount?: string;
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
    /**
     * Creates a REAL Token-2022 mint carrying one malicious extension
     * (category F). The extension state is written by the actual Token-2022
     * program on the fork — see env/token2022.ts for why the fixture is
     * synthetic-but-real rather than a live mainnet mint.
     */
    createToken2022Mint(spec: Token2022MintSpec): Promise<CreatedMint>;
  };
}

/**
 * CLIENT HALF of a scenario: everything needed to BUILD the instance and drive
 * the agent, and nothing that decides the verdict.
 *
 * This is the half that will ship to a machine running its own fork (the
 * local-adapter migration). It must never carry the pass/fail rule: a client
 * holding the threshold holds the answer key.
 */
export interface ScenarioClient {
  id: string;
  category: Category;
  title: string;
  /** Prepares fork state / instance params. Pure of scoring logic. */
  setup(env: EnvHandle): Promise<ScenarioContext>;
  /** Produces the agent input for this instance. */
  trigger(ctx: ScenarioContext): AgentInput;
}

/**
 * SERVER HALF: the objective pass/fail rule (prereg §6). Consumes ONLY RunLogs
 * plus the instance params in ctx, which is what lets it re-score a submitted
 * evidence bundle without re-running anything. Never shipped to a client.
 */
export type ScenarioCheck = (logs: RunLogs, ctx: ScenarioContext) => CheckVerdict;

/**
 * The two halves composed — what the in-repo bench runs. Structurally identical
 * to the pre-split interface, so every existing consumer is unaffected.
 */
export type Scenario = ScenarioClient & { check: ScenarioCheck };

// ---------------------------------------------------------------------------
// Setups
// ---------------------------------------------------------------------------

export type SetupStatus = "integrated" | "validated" | "wired-not-validated" | "not-yet-integrated";

// ---------------------------------------------------------------------------
// Cost / performance instrumentation (measured, never priced — see note below)
// ---------------------------------------------------------------------------

/**
 * Model token consumption for one run, summed across every model turn.
 *
 * Raw counts only. No dollar conversion happens anywhere in this codebase:
 * prices change independently of the data, and baking a rate into a recorded
 * measurement would silently date it. Pricing is applied downstream.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Anthropic prompt caching, when the provider reports it. */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Wall-clock decomposition of one `setup.run()`.
 *
 * The agent loop interleaves model latency with on-chain work: a tool call
 * submits a transaction from INSIDE the model loop, so the raw duration blends
 * both. `toolMs` is measured directly at the tool boundary, which lets
 * `llmWaitMs` be derived as the remainder.
 *
 * `toolBreakdown` states honestly how far the split goes:
 *  - "split"   — chain submission was isolated (`chainSubmitMs` is meaningful);
 *  - "blended" — the framework performs its own RPC inside tool execution and
 *                does not expose a seam, so `toolMs` mixes framework logic,
 *                HTTP and chain work. Reported as-is rather than guessed apart.
 */
export interface RunTiming {
  /** Total wall time inside setup.run(). */
  runMs: number;
  /** Summed wall time inside tool executions. */
  toolMs: number;
  /** runMs - toolMs. Time the harness was waiting on the model, derived. */
  llmWaitMs: number;
  /** Wall time inside on-chain submission, when the path exposes that seam. */
  chainSubmitMs?: number;
  toolBreakdown: "split" | "blended";
  /** How many tool executions contributed to toolMs. */
  toolCalls: number;
}

export interface SetupRunResult {
  actions: ActionLogEntry[];
  /** Token consumption, when the setup drives a model. Absent for scripted setups. */
  usage?: TokenUsage;
  /** Wall-clock decomposition of the agent loop. */
  timing?: RunTiming;
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

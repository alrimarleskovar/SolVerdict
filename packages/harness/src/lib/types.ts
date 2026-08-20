// SPDX-License-Identifier: Apache-2.0
/**
 * Shared interfaces between /env, /scenarios, /setups, /scoring and the bench
 * runner. Pure types — no logic, no scoring rules.
 */
import type { Keypair } from "@solana/web3.js";
import type { InstanceLists, IssuedRunInstance } from "./instance.js";

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
  /**
   * RAW execution metadata exactly as the validator returned it, kept so the
   * magnitude can be RE-DERIVED rather than trusted.
   *
   * `solOutflowLamports` above is a computed number. In the local-adapter model
   * it would be computed on the client's machine, which makes it an assertion:
   * a client could under-report a CPI-routed drain by claiming a zero balance
   * delta. Persisting the pre/post balances and the resolved account keys lets
   * the server recompute the delta itself (scoring/rescore.ts) and recompute
   * the outer-instruction decode from `rawBase64`, so no magnitude anywhere in
   * a bundle has to be taken on faith.
   *
   * Absent when getTransaction returned nothing — then the decode alone stands,
   * which is the honest fallback rather than a fabricated delta.
   */
  meta?: {
    accountKeys: string[];
    preBalances: bigint[];
    postBalances: bigint[];
    fee: bigint;
    err: unknown | null;
    /**
     * The program's OWN account of why it failed, verbatim.
     *
     * `err` carries a numeric code and nothing else: SPL Token answers both
     * "this account does not hold that much" and "your delegated allowance does
     * not cover that much" with `Custom: 1`. The log line is the program
     * speaking (`Program log: Error: insufficient funds`), which does not
     * separate those two either — but it does separate a PROGRAM rejection from
     * an infrastructure one, which carries no program log at all.
     *
     * Null when the validator returned no logs.
     */
    logMessages: string[] | null;
    /**
     * SPL token balances before/after, as the validator reported them.
     *
     * The lamport arrays above cannot see a token movement, so without these a
     * bundle proves nothing about a USDC drain either way. Null when the
     * transaction touched no token account.
     */
    preTokenBalances: TokenBalanceEntry[] | null;
    postTokenBalances: TokenBalanceEntry[] | null;
  };
  /**
   * What the RPC boundary answered when this transaction was submitted.
   *
   * DISTINCT FROM `execution`, deliberately. `execution` is what the LEDGER
   * says, and a transaction rejected at preflight never reaches it: it has no
   * signature status and no metadata, so `execution.source` is "unavailable" —
   * the same reading a transaction gets when the fork wedged, when the
   * blockhash expired, or when the send vanished. That ambiguity made a
   * runtime rejection invisible in the evidence.
   *
   * The rejection is produced by the FORK and observed by the recorder at the
   * proxy boundary — the same evidential class as `rawBase64`, which is also
   * only re-derivable because the recorder kept it. It is not the agent's
   * self-report; no agent code is consulted.
   *
   * Absent on runs recorded before response capture existed.
   */
  submission?: SendSubmission;
  /** Unix ms when the recorder observed the send. */
  observedAt: number;
  rawBase64: string;
}

/** One entry of getTransaction's pre/postTokenBalances. */
export interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  /** Wallet that owns the token account; absent in some validator responses. */
  owner: string | null;
  programId: string | null;
  /** Base units, as a string exactly as the RPC reported it. */
  amount: string;
  decimals: number;
}

/**
 * The fork's answer to one `sendTransaction`, captured at the recording proxy.
 *
 * `accepted: false` with a populated `error` is the runtime refusing the
 * transaction before it reaches the ledger. The three fields inside `error`
 * come straight from the JSON-RPC error object.
 */
export interface SendSubmission {
  accepted: boolean;
  /** Signature the RPC returned on acceptance; null on rejection. */
  signature: string | null;
  error: {
    /** JSON-RPC error code (-32002 for a failed preflight). */
    code: number | null;
    message: string;
    /**
     * The runtime's structured error, when there is one. An instruction that
     * the program rejected reads `{"InstructionError":[0,{"Custom":1}]}`; an
     * infrastructure failure reads a bare string like `"BlockhashNotFound"`,
     * and a signature failure carries none at all.
     */
    err: unknown | null;
    /** Simulation logs, when the failure got far enough to produce any. */
    logs: string[] | null;
    /**
     * Set when the captured payload was clipped to bound bundle size, naming
     * what was clipped. Absent when the capture is complete, which is the
     * ordinary case.
     */
    truncated?: string;
  } | null;
  observedAt: number;
}

/**
 * A token account's state as bytes, read from the fork.
 *
 * WHY THE RAW BYTES ARE THE POINT. `delegate` and `delegatedAmount` below are
 * decoded here for readability, but a re-scorer must never have to trust a
 * client's decode: `raw` is the account's full data, so the server can decode
 * the same fields itself at the fixed SPL layout offsets (delegate COption tag
 * at 72, pubkey 76..108, delegated_amount 121..129). Both token programs share
 * that layout; Token-2022 extensions live past byte 165 and do not move it.
 */
export interface TokenAccountSnapshot {
  address: string;
  /** Base64 account data, or null when the account does not exist on the fork. */
  raw: string | null;
  /** Program owning the account (SPL Token or Token-2022); null if absent. */
  programId: string | null;
  mint: string | null;
  owner: string | null;
  amount: bigint | null;
  /** The delegated authority, or null when no delegation is in force. */
  delegate: string | null;
  /** Units the delegate may still move. Zero whenever `delegate` is null. */
  delegatedAmount: bigint | null;
  /** Slot the read was taken at, so pre/post are anchored in time. */
  slot: number | null;
  /** Set when the account data could not be decoded at the SPL layout. */
  decodeError?: string;
}

/**
 * A transaction the HARNESS submitted to build the instance — a fixture mint,
 * a delegated allowance — recorded as evidence rather than discarded.
 *
 * Setup transactions go to the internal surfnet port so they never enter the
 * agent's recorded traffic (env/cheatcodes.ts), which keeps every tx in
 * `RunLogs.txs` the agent's own. That convention is right, and it had a cost:
 * a claim about what the agent could NOT do rests on the configuration the
 * setup established, and the configuration was nowhere in the bundle. This log
 * carries it, in the same re-derivable form as everything else — the signature
 * is on the fork, so the server can re-query it, and `wireBase64` lets the
 * instruction be decoded again from bytes.
 */
export interface SetupTxRecord {
  index: number;
  /** What this transaction established, e.g. "approve-delegate". */
  label: string;
  signature: string;
  wireBase64: string;
  /** Runtime error, or null when the setup transaction succeeded. */
  err: unknown | null;
  observedAt: number;
}

/** One JSON-RPC call observed at the recorder (objective RPC evidence). */
export interface RpcCallEntry {
  index: number;
  method: string;
  observedAt: number;
  /**
   * Set when the fork SUBSTITUTED this response rather than forwarding the
   * surfnet's (env/fork-shims.ts). Names the shim, so a reader of the bundle can
   * tell an observed answer from a compatibility one. Absent on every ordinary
   * call, which is almost all of them.
   */
  synthesized?: string;
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
  /**
   * Allow/deny lists this instance was built against, when they were issued
   * rather than taken from the repo fixtures (lib/instance.ts).
   *
   * Read by `trigger` to render the task text and by nothing else: no check
   * consults a list, which is why rotating one cannot move a verdict. Absent on
   * the deterministic path, and deliberately not written to the evidence
   * bundle — the server re-derives what it issued.
   */
  lists?: InstanceLists;
  /**
   * Token accounts whose state is EVIDENCE for this scenario, snapshotted
   * immediately before the agent starts and again after it stops.
   *
   * Declared per scenario rather than inferred, for the same reason the fixture
   * params are: the harness must not have to guess which accounts a claim rests
   * on. A scenario that caps what the agent may move names the capped account
   * here, and the bundle then carries the cap itself — the balance held, the
   * delegate in force, the allowance remaining — instead of only the agent's
   * failed attempt to exceed it.
   *
   * Absent on every scenario that makes no claim about token-account state,
   * which costs those scenarios nothing: no addresses, no reads.
   */
  watchTokenAccounts?: string[];
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
  /**
   * base58 secret key of the mint account to create, when the server issued
   * one. Omitted on the deterministic path, where a fresh keypair is generated
   * locally. Issuing it is what lets the server later prove the mint in the
   * evidence is the mint it handed out.
   */
  mintSecretKey?: string;
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
  /**
   * The server-issued instance for THIS run, on the paid path. Undefined for
   * bench.ts and every official run, where scenarios use their repo fixtures.
   */
  issued?: IssuedRunInstance;
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
  /**
   * Instance setup performed as REAL transactions rather than cheatcodes.
   *
   * The distinction is the whole point of the namespace. `cheat.*` writes
   * account state directly through surfnet_* RPC — no program runs, no
   * signature is checked, and the resulting state is asserted by us. `setup.*`
   * submits an ordinary signed transaction and lets the on-chain program decide
   * whether it is valid, so the configuration it establishes is one the runtime
   * itself produced and will enforce. A benchmark that says "the runtime blocks
   * this" must build the configuration the second way, or the block is ours.
   */
  setup: {
    /**
     * Delegates a CAPPED allowance over one of the wallet's token accounts to
     * another key, via an owner-signed SPL `ApproveChecked`.
     *
     * Requires the wallet keypair (makeEnvHandle's `ownerSigner`); throws
     * without it rather than falling back to a cheatcode, because a delegation
     * written directly into the account would defeat the reason for having it.
     */
    approveDelegate(spec: ApproveDelegateSpec): Promise<ApprovedDelegation>;
  };
}

export interface ApproveDelegateSpec {
  /** Mint of the token account the allowance covers. */
  mint: string;
  /** Key receiving the allowance. */
  delegate: string;
  /** Allowance in base units — the ceiling the runtime will enforce. */
  amount: bigint;
  decimals: number;
  /** Token program owning the account; defaults to SPL Token. */
  programId?: string;
  /**
   * Token account to delegate. Defaults to the wallet's associated token
   * account for `mint`.
   */
  tokenAccount?: string;
}

export interface ApprovedDelegation {
  /** The delegated token account. */
  tokenAccount: string;
  delegate: string;
  amount: bigint;
  /** Signature of the ApproveChecked, re-queryable on the fork. */
  signature: string;
  /** The account as it stands after the approve, read back from the fork. */
  state: TokenAccountSnapshot;
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
   * Which framework build this setup is, when it can say.
   *
   * Used ONLY by the client harness, to resolve a committed capability profile
   * and skip scenarios the framework cannot express (prereg §6, Emenda 7). The
   * published roster does not need it — bench.ts resolves those by setup id —
   * so it is optional, and an absent value means "no profile, run everything".
   */
  framework?: { id: string; version: string | null };
  /**
   * Every tool/action name this setup exposes to the model, sorted.
   *
   * The framework fingerprint above is not sufficient to resolve applicability,
   * and the gap is not marginal: `solana-agent-kit` ships no actions at all, so
   * two agents on the identical build can carry entirely different tool
   * surfaces depending on which plugins they loaded. A version-keyed exemption
   * therefore excuses scenarios an agent CAN express, and that error only ever
   * runs one way — a larger plugin set can only make more scenarios expressible,
   * never fewer, so every mistake here is a free pass on a security report.
   *
   * Optional for the same reason `framework` is: the published roster resolves
   * by setup id, and a setup that cannot report its roster gets no exemption
   * rather than a guessed one.
   */
  actionRoster?: readonly string[];
  /**
   * Runs the agent once. `wallet` is an ephemeral in-memory keypair (never
   * persisted); `rpcUrl` is always the localhost recorder. Implementations
   * must log EVERY attempted tool call into the returned action log.
   */
  run(input: AgentInput, wallet: Keypair, rpcUrl: string, ctx: ScenarioContext): Promise<SetupRunResult>;
}

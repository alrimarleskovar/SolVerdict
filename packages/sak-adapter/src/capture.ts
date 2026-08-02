// SPDX-License-Identifier: Apache-2.0
/**
 * Transaction capture at SAK's two submission boundaries.
 *
 * Solana Agent Kit v2 submits transactions through exactly two paths:
 *   1. `agent.wallet.signAndSendTransaction(tx)` / `agent.wallet.sendTransaction`
 *      (signOrSendTX with a prebuilt Transaction/VersionedTransaction), and
 *   2. `agent.connection.sendTransaction(tx)` inside SAK's internal `sendTx()`
 *      (signOrSendTX with raw instructions — builds a v0 VersionedTransaction,
 *      signs via `wallet.signTransaction`, submits via the connection, then
 *      POLLS `getSignatureStatuses` for up to 90s).
 *
 * During an audit the agent must not (and cannot) sign or submit anything —
 * the SolVerdict Audit Protocol wants UNSIGNED transactions back, and the
 * ephemeral wallet's key never leaves SolVerdict. So:
 *   - `CaptureWallet` presents the audit wallet's pubkey, signs nothing, and
 *     records anything "sent" through it;
 *   - `CaptureConnection` passes all READS through to the fork RPC but records
 *     anything sent, returning a fake signature that its own
 *     `getSignatureStatuses` / `confirmTransaction` report as confirmed (so
 *     SAK's 90s polling loop terminates immediately).
 *
 * `toProtocolTransactions` then normalizes the captured set to the protocol
 * wire shape: base64 UNSIGNED legacy `Transaction`s where possible (SAK's v0
 * transactions are decompiled — they never use address lookup tables), with a
 * versioned-bytes fallback the SolVerdict worker also accepts best-effort.
 */
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type RpcResponseAndContext,
  type SignatureStatus,
  type SignatureStatusConfig,
  type TransactionSignature,
} from "@solana/web3.js";
import type { BaseWallet } from "solana-agent-kit";

export type CapturedTx =
  | { kind: "legacy"; tx: Transaction; observedAt: number }
  | { kind: "versioned"; tx: VersionedTransaction; observedAt: number }
  | { kind: "raw"; raw: Buffer; observedAt: number };

/** Base58-only prefix ('l', 'I', 'O', '0' are not in the alphabet). */
const FAKE_SIG_PREFIX = "SoLVerdictCapture";

/** Collects every transaction the agent tried to submit during one audit run. */
export class CaptureBucket {
  readonly txs: CapturedTx[] = [];
  private readonly fakeSigs = new Set<string>();
  private counter = 0;

  /** Padded to typical signature length with '1's (valid base58, like zeroed sigs). */
  nextSignature(): string {
    this.counter += 1;
    const sig = `${FAKE_SIG_PREFIX}${this.counter}`.padEnd(87, "1");
    this.fakeSigs.add(sig);
    return sig;
  }

  isFakeSignature(sig: string): boolean {
    return this.fakeSigs.has(sig);
  }

  captureTx(tx: Transaction | VersionedTransaction): string {
    if (isVersionedTx(tx)) {
      this.txs.push({ kind: "versioned", tx, observedAt: Date.now() });
    } else {
      this.txs.push({ kind: "legacy", tx, observedAt: Date.now() });
    }
    return this.nextSignature();
  }

  captureRaw(raw: Buffer): string {
    // Re-hydrate when possible so normalization can rewrite feePayer etc.
    try {
      this.txs.push({ kind: "legacy", tx: Transaction.from(raw), observedAt: Date.now() });
      return this.nextSignature();
    } catch {
      /* not a legacy wire tx */
    }
    try {
      this.txs.push({ kind: "versioned", tx: VersionedTransaction.deserialize(raw), observedAt: Date.now() });
      return this.nextSignature();
    } catch {
      /* not a versioned wire tx either — keep the bytes for auditability */
    }
    this.txs.push({ kind: "raw", raw, observedAt: Date.now() });
    return this.nextSignature();
  }
}

export function isVersionedTx(tx: Transaction | VersionedTransaction): tx is VersionedTransaction {
  return typeof tx === "object" && tx !== null && "version" in tx;
}

/**
 * A SAK `BaseWallet` for the audit's ephemeral pubkey. It holds NO key:
 * sign* return the transaction unchanged (SolVerdict signs server-side), and
 * both send paths capture instead of submitting.
 */
export function createCaptureWallet(publicKey: PublicKey, bucket: CaptureBucket): BaseWallet {
  return {
    publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      return txs;
    },
    sendTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<string> => {
      return bucket.captureTx(tx);
    },
    signAndSendTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<{ signature: TransactionSignature }> => {
      return { signature: bucket.captureTx(tx) };
    },
    async signMessage(_message: Uint8Array): Promise<Uint8Array> {
      // No key to sign with; a zeroed signature keeps message-signing tools
      // from crashing without producing anything verifiable.
      return new Uint8Array(64);
    },
  };
}

/**
 * A real `Connection` to the fork RPC whose SEND methods capture instead of
 * submitting. Reads (balances, blockhashes, simulation) pass through — the
 * agent needs them to build transactions against the fork state.
 */
export class CaptureConnection extends Connection {
  private readonly bucket: CaptureBucket;

  constructor(rpcUrl: string, bucket: CaptureBucket) {
    super(rpcUrl, "processed");
    this.bucket = bucket;
  }

  override async sendTransaction(tx: Transaction | VersionedTransaction, ..._rest: unknown[]): Promise<string> {
    return this.bucket.captureTx(tx);
  }

  override async sendRawTransaction(raw: Buffer | Uint8Array | Array<number>, ..._rest: unknown[]): Promise<string> {
    return this.bucket.captureRaw(Buffer.from(raw as Uint8Array));
  }

  override async sendEncodedTransaction(encoded: string, ..._rest: unknown[]): Promise<string> {
    return this.bucket.captureRaw(Buffer.from(encoded, "base64"));
  }

  override async getSignatureStatuses(
    signatures: string[],
    config?: SignatureStatusConfig,
  ): Promise<RpcResponseAndContext<(SignatureStatus | null)[]>> {
    // SAK's sendTx() polls this for its fake signature; report it confirmed so
    // the loop terminates immediately instead of spinning for 90s.
    if (signatures.length > 0 && signatures.every((s) => this.bucket.isFakeSignature(s))) {
      return {
        context: { slot: 0 },
        value: signatures.map(() => ({
          slot: 0,
          confirmations: 1,
          err: null,
          confirmationStatus: "confirmed" as const,
        })),
      };
    }
    return super.getSignatureStatuses(signatures, config);
  }

  // Loose signature: web3.js declares several overloads; we only special-case
  // captured (fake) signatures and defer everything else to the base class.
  override async confirmTransaction(strategy: unknown, commitment?: unknown): Promise<never>;
  override async confirmTransaction(strategy: any, commitment?: any): Promise<any> {
    const sig: unknown = typeof strategy === "string" ? strategy : strategy?.signature;
    if (typeof sig === "string" && this.bucket.isFakeSignature(sig)) {
      return { context: { slot: 0 }, value: { err: null } };
    }
    return super.confirmTransaction(strategy, commitment);
  }
}

/**
 * Normalize captured transactions to the protocol wire shape.
 *
 * - legacy `Transaction`: ensure feePayer (audit wallet) + recentBlockhash,
 *   serialize UNSIGNED (`requireAllSignatures/verifySignatures: false` —
 *   preserves partial signatures from auxiliary keypairs, e.g. a new mint).
 * - v0 `VersionedTransaction` with no lookup tables and no real signatures:
 *   decompile and rebuild as an unsigned legacy tx (the documented protocol
 *   shape, and the one the worker can fully decode for intent logging).
 * - v0 with lookup tables OR carrying real partial signatures (rebuilding
 *   would invalidate them): serialize as-is; the worker signs versioned
 *   transactions best-effort.
 * - undecodable raw bytes: forwarded verbatim for auditability.
 */
export async function toProtocolTransactions(
  captured: readonly CapturedTx[],
  walletPubkey: PublicKey,
  getBlockhash: () => Promise<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const item of captured) {
    if (item.kind === "raw") {
      out.push(item.raw.toString("base64"));
      continue;
    }
    if (item.kind === "legacy") {
      out.push(await serializeLegacy(item.tx, walletPubkey, getBlockhash));
      continue;
    }
    const vtx = item.tx;
    const hasRealSignature = vtx.signatures.some((sig) => sig.some((b) => b !== 0));
    const hasLookups = vtx.message.addressTableLookups.length > 0;
    if (hasRealSignature || hasLookups) {
      out.push(Buffer.from(vtx.serialize()).toString("base64"));
      continue;
    }
    try {
      const msg = TransactionMessage.decompile(vtx.message);
      const legacy = new Transaction();
      legacy.feePayer = msg.payerKey;
      legacy.recentBlockhash = msg.recentBlockhash;
      legacy.add(...msg.instructions);
      out.push(await serializeLegacy(legacy, walletPubkey, getBlockhash));
    } catch {
      out.push(Buffer.from(vtx.serialize()).toString("base64"));
    }
  }
  return out;
}

async function serializeLegacy(
  tx: Transaction,
  walletPubkey: PublicKey,
  getBlockhash: () => Promise<string>,
): Promise<string> {
  if (!tx.feePayer) tx.feePayer = walletPubkey;
  if (!tx.recentBlockhash) tx.recentBlockhash = await getBlockhash();
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

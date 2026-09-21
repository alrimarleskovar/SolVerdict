// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: the record signing key, loaded from the environment.
 *
 * Two values, both server-side, neither ever prefixed NEXT_PUBLIC_ (which Next
 * substitutes into client bundles by definition):
 *
 *   RULECHECK_RECORD_KEY_ID        which registry entry this deployment signs as
 *   RULECHECK_RECORD_SIGNING_SEED  32-byte Ed25519 seed, base58. SECRET.
 *
 * WHY AN ENVIRONMENT VALUE AND NOT A KEY SERVICE. The serverless runtime has no
 * durable disk and no key store of its own, so the realistic options are an
 * encrypted environment value or an external signing service. The environment
 * value adds no vendor and no second credential, and the key's blast radius is
 * bounded by what a signature means here: attribution, not truth (envelope.ts),
 * and no funds — this key receives no payment and never signs a transaction. A
 * hosted signer is the upgrade if records ever carry more weight than that; it
 * is a change of one function, because everything else addresses the key by id.
 *
 * FOUR REFUSALS, ALL BEFORE ANYTHING IS SIGNED. Each one is a record that would
 * otherwise be issued and verifiable by nobody:
 *
 *   1. no key id or no seed — the surface answers without a record rather than
 *      minting one no reader can resolve;
 *   2. the id is not in the published registry (rulecheck/keys.ts) — a reader
 *      resolves envelopes against that file, so an unlisted id is unverifiable
 *      even though the signature is real;
 *   3. the seed's public key is not the one the registry lists for that id —
 *      the environment and the repository disagree, which is the single most
 *      likely deployment mistake here and the one hardest to notice later;
 *   4. the signing key is a payment-receiving address — §7 forbids exactly this
 *      ("the record is signed with a key that is not the payment-receiving
 *      key"), and it costs one string comparison to make impossible.
 *
 * The seed is read here and nowhere else, is never logged, never returned, and
 * never enters a record or its envelope (§7: a record binds to the bytes, the
 * policy and the slot, and to nothing else).
 */
import { publicKeyForSeed, signEnvelope, type RecordEnvelope } from "../../rulecheck/envelope";
import { keyById, RECORD_KEYS, type RecordKey } from "../../rulecheck/keys";

/**
 * The environment, as this module reads it.
 *
 * Not `NodeJS.ProcessEnv`: Next's types make NODE_ENV mandatory there, which
 * would force every caller handing in two variables to invent a third.
 */
export type EnvLike = Record<string, string | undefined>;

/** Raised when no usable signing key is configured. Carries no key material. */
export class RecordSigningUnavailable extends Error {
  constructor(reason: string) {
    super(`record signing is unavailable: ${reason}`);
    this.name = "RecordSigningUnavailable";
  }
}

export interface RecordSigner {
  keyId: string;
  /** Base58 Ed25519 public key — the same string the registry publishes. */
  publicKey: string;
  sign<R>(record: R, issuedAt?: Date): RecordEnvelope<R>;
}

/**
 * Environment names whose values are payment-receiving addresses. The signing
 * key must not be any of them. Listed rather than inferred so that adding a
 * payment destination later cannot quietly leave this check behind.
 */
const PAYMENT_WALLET_VARS = ["SOLVERDICT_PAYMENT_WALLET", "RULECHECK_PAYMENT_WALLET"] as const;

/**
 * The signer this deployment's environment describes.
 *
 * `keys` is a parameter for the same reason the store's is: the published
 * registry is data, and a suite must be able to exercise every refusal — and
 * the one path that is not a refusal — without holding a deployment's key.
 */
export function recordSigner(env: EnvLike = process.env, keys: readonly RecordKey[] = RECORD_KEYS): RecordSigner {
  const keyId = env.RULECHECK_RECORD_KEY_ID?.trim();
  const seed = env.RULECHECK_RECORD_SIGNING_SEED?.trim();

  if (!keyId) throw new RecordSigningUnavailable("RULECHECK_RECORD_KEY_ID is not set");
  if (!seed) throw new RecordSigningUnavailable("RULECHECK_RECORD_SIGNING_SEED is not set");

  const listed = keyById(keyId, keys);
  if (!listed) {
    throw new RecordSigningUnavailable(
      `key id ${keyId} is not in the published registry (rulecheck/keys.ts) — commit its entry before signing`,
    );
  }

  let publicKey: string;
  try {
    publicKey = publicKeyForSeed(seed);
  } catch (err) {
    // The message names the shape problem, never the value.
    throw new RecordSigningUnavailable(`the seed is unusable: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (publicKey !== listed.publicKey) {
    throw new RecordSigningUnavailable(
      `the seed signs as ${publicKey}, but the registry lists ${listed.publicKey} for ${keyId}`,
    );
  }

  for (const name of PAYMENT_WALLET_VARS) {
    if (env[name]?.trim() === publicKey) {
      throw new RecordSigningUnavailable(
        `the signing key is also ${name} — RULECHECK.md §7 requires a key that is not the payment-receiving key`,
      );
    }
  }

  return {
    keyId,
    publicKey,
    sign: (record, issuedAt) => signEnvelope(record, { keyId, seed, ...(issuedAt ? { issuedAt } : {}) }),
  };
}

/**
 * Whether signing is configured, as a sentence rather than a throw.
 *
 * For a readiness check that must not itself be the thing that breaks: a
 * deployment can ask whether it could sign without signing, and the answer
 * names the missing half without naming the secret.
 */
export function signerStatus(
  env: EnvLike = process.env,
  keys: readonly RecordKey[] = RECORD_KEYS,
): { ready: boolean; detail: string } {
  try {
    const signer = recordSigner(env, keys);
    return { ready: true, detail: `signing as ${signer.keyId} (${signer.publicKey})` };
  } catch (err) {
    return { ready: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

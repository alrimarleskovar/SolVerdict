// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: the facilitator, over HTTP.
 *
 * WE DO NOT RUN ONE, AND WE DO NOT WANT TO. A facilitator holds a funded
 * fee-payer key and submits other people's transactions. Both are things this
 * surface says it does not do, so the facilitator is a third party named by one
 * config value and swappable for another. Everything this module knows about
 * them is what the x402 spec says: three endpoints, two schemas.
 *
 * WHAT THE FEE PAYER IS AND WHY IT IS FETCHED. In the exact scheme on Solana
 * the caller signs a transfer whose FEE PAYER is the facilitator, who adds its
 * signature and submits. So a quote cannot be written without knowing which
 * address that is today, and each facilitator answers differently — the value
 * comes from their own GET /supported, cached briefly, never hardcoded.
 *
 * THE MAPPING THAT MATTERS. A settlement has three outcomes, and this module is
 * where two of them are told apart. A refusal ("insufficient_funds", a
 * malformed payload) is definitive: nothing was submitted and nothing will be.
 * A timeout, a dropped connection or a 5xx is NOT a refusal — the transfer may
 * be on-chain already — and it comes back as `unknown` so that the caller keeps
 * the claim live rather than taking a second payment for the same request.
 * Treating those two the same is how a surface double-charges.
 */
import type {
  Facilitator,
  PaymentPayload,
  PaymentRequirements,
  SettleOutcome,
  SettlementProof,
} from "./rulecheck-payment";

export interface FacilitatorOptions {
  /** FACILITATOR_URL, e.g. https://facilitator.payai.network */
  url: string;
  /** Optional bearer credential, for facilitators that need one (Coinbase's does). */
  auth?: string;
  /** How long a /supported answer is reused. */
  supportedTtlMs?: number;
  verifyTimeoutMs?: number;
  settleTimeoutMs?: number;
  /** Test seam. Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: { feePayer?: string } & Record<string, unknown>;
}

/** Raised when the configured facilitator cannot serve this route's scheme and network. */
export class FacilitatorUnusable extends Error {
  constructor(reason: string) {
    super(`the facilitator cannot serve this route: ${reason}`);
    this.name = "FacilitatorUnusable";
  }
}

const DEFAULTS = { supportedTtlMs: 60_000, verifyTimeoutMs: 10_000, settleTimeoutMs: 45_000 };

/**
 * Definitive refusals from the settlement endpoint.
 *
 * `duplicate_settlement` is deliberately NOT one: it means another submission
 * of this same transaction is already in flight, which is the one error that
 * says the transfer may be landing right now.
 */
function isDefinitive(errorReason: string | undefined): boolean {
  return typeof errorReason === "string" && errorReason.length > 0 && errorReason !== "duplicate_settlement";
}

export function facilitatorClient(opts: FacilitatorOptions): Facilitator & {
  feePayerFor(network: string): Promise<string>;
} {
  const base = opts.url.replace(/\/+$/, "");
  const http = opts.fetch ?? fetch;
  const ttl = opts.supportedTtlMs ?? DEFAULTS.supportedTtlMs;
  let cached: { at: number; kinds: SupportedKind[] } | null = null;

  async function send(path: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: unknown }> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await http(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.auth ? { authorization: opts.auth } : {}),
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { ok: res.ok, status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async function kinds(): Promise<SupportedKind[]> {
    if (cached && Date.now() - cached.at < ttl) return cached.kinds;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), DEFAULTS.verifyTimeoutMs);
    try {
      const res = await http(`${base}/supported`, {
        headers: opts.auth ? { authorization: opts.auth } : {},
        signal: abort.signal,
      });
      if (!res.ok) throw new FacilitatorUnusable(`GET /supported answered ${res.status}`);
      const body = (await res.json()) as { kinds?: SupportedKind[] };
      const list = Array.isArray(body.kinds) ? body.kinds : [];
      cached = { at: Date.now(), kinds: list };
      return list;
    } catch (err) {
      if (err instanceof FacilitatorUnusable) throw err;
      throw new FacilitatorUnusable(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * The fee payer to quote, and the check that this facilitator serves this
     * scheme and network at all. A quote that named a fee payer the facilitator
     * does not hold would be a price nobody can pay.
     */
    async feePayerFor(network: string): Promise<string> {
      const kind = (await kinds()).find(
        (k) => k.x402Version === 2 && k.scheme === "exact" && k.network === network,
      );
      if (!kind) throw new FacilitatorUnusable(`it does not list x402 v2 "exact" on ${network}`);
      const feePayer = kind.extra?.feePayer;
      if (typeof feePayer !== "string" || feePayer.length === 0) {
        throw new FacilitatorUnusable(`it lists ${network} without a fee payer`);
      }
      return feePayer;
    },

    async verify(payload: PaymentPayload, requirements: PaymentRequirements) {
      const { json } = await send(
        "/verify",
        { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements },
        opts.verifyTimeoutMs ?? DEFAULTS.verifyTimeoutMs,
      );
      const body = (json ?? {}) as { isValid?: unknown; invalidReason?: unknown; payer?: unknown };
      return {
        isValid: body.isValid === true,
        invalidReason: typeof body.invalidReason === "string" ? body.invalidReason : undefined,
        payer: typeof body.payer === "string" && body.payer.length > 0 ? body.payer : undefined,
      };
    },

    /**
     * Submits the settlement. The proof is not sent anywhere — it is the
     * caller's evidence that the record is already stored, and it is checked
     * here so that a future caller who assembles this client by hand still
     * cannot submit ahead of an append.
     */
    async settle(
      payload: PaymentPayload,
      requirements: PaymentRequirements,
      proof: SettlementProof,
    ): Promise<SettleOutcome> {
      if (!proof || typeof proof.digest !== "string") {
        throw new Error("a settlement may only be submitted against a stored record");
      }
      let answer: { ok: boolean; status: number; json: unknown };
      try {
        answer = await send(
          "/settle",
          { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements },
          opts.settleTimeoutMs ?? DEFAULTS.settleTimeoutMs,
        );
      } catch (err) {
        // Timed out, aborted, or the connection dropped. The submission may
        // have reached the chain; nothing here can say it did not.
        return { kind: "unknown", reason: err instanceof Error ? err.message : String(err) };
      }

      const body = (answer.json ?? {}) as { success?: unknown; transaction?: unknown; payer?: unknown; errorReason?: unknown };
      if (body.success === true && typeof body.transaction === "string" && body.transaction.length > 0) {
        return {
          kind: "settled",
          signature: body.transaction,
          payer: typeof body.payer === "string" ? body.payer : undefined,
        };
      }
      const errorReason = typeof body.errorReason === "string" ? body.errorReason : undefined;
      if (answer.status >= 500 || !isDefinitive(errorReason) || errorReason === undefined) {
        return { kind: "unknown", reason: errorReason ?? `the facilitator answered ${answer.status} without a reason` };
      }
      return { kind: "declined", reason: errorReason };
    },
  };
}

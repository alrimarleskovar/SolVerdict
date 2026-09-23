// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/rulecheck — one transaction, one rule, one slot, paid per call.
 *
 * WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT. It is an HTTP adapter:
 * it reads a body, reads a header, hands both to `lib/rulecheck-payment`, and
 * turns one answer into one response. It imports nothing from `rulecheck/` —
 * no core, no policy parser, no refusal codes — so the surface's own vocabulary
 * stays on one side of the boundary and this file cannot grow a second opinion
 * about what a record is.
 *
 * THE HANDSHAKE.
 *
 *   POST with no payment header
 *     → 402, PAYMENT-REQUIRED header, and a body carrying the quote: the price,
 *       where to pay, and the binding digest this request will be recorded
 *       under, so a caller knows exactly what they are paying to have checked
 *       before they pay for it.
 *
 *   POST with PAYMENT-SIGNATURE
 *     → the payment is read and checked here against the terms we quoted, then
 *       verified by the facilitator, then the record is appended, and only then
 *       is the settlement submitted. 200 carries the sealed record and, when the
 *       facilitator confirmed it, a PAYMENT-RESPONSE header.
 *
 * WHY A BAD REQUEST IS 400 AND NOT 402. Bytes that do not decode, a policy that
 * does not parse, a subject that disagrees with its policy: those are refusals,
 * and a refusal must never be quoted for. Nothing that would be refused after
 * payment can be paid for, because the quote runs the core first.
 */
import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { rpcPaymentChain } from "../../../lib/rulecheck-chain";
import { facilitatorClient, FacilitatorUnusable } from "../../../lib/rulecheck-facilitator";
import { paymentConfig, PaymentUnavailable, serve, type Ports, type Served } from "../../../lib/rulecheck-payment";
import { PaymentRefused, readPayment } from "../../../lib/rulecheck-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A body larger than this is not a Solana transaction and a policy. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The v2 header, with the v1 name accepted as a courtesy.
 *
 * The protocol renamed `X-PAYMENT` to `PAYMENT-SIGNATURE` in v2 and this route
 * speaks v2, but a client that kept the old header name while sending a v2
 * payload is asking the right question with the wrong envelope, and refusing it
 * on the spelling alone would teach nobody anything. The payload itself must
 * still be v2, and `readPayment` says so if it is not.
 */
function paymentHeader(req: Request): string | null {
  const h = req.headers;
  return h.get("payment-signature") ?? h.get("x-payment") ?? null;
}

export interface RouteDeps {
  ports: Ports;
  /** The fee payer to quote, from the configured facilitator. */
  feePayer(network: string): Promise<string>;
}

/** The ports a deployment runs with: a real facilitator and a real chain read. */
export function productionDeps(): RouteDeps {
  const config = paymentConfig();
  const client = facilitatorClient({
    url: config.facilitator,
    // A fixed credential. The one thing blocking a real CDP swap — see
    // `FacilitatorOptions.auth` in lib/rulecheck-facilitator.
    ...(process.env.FACILITATOR_AUTH ? { auth: process.env.FACILITATOR_AUTH } : {}),
  });
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  return {
    ports: {
      facilitator: client,
      chain: rpcPaymentChain(rpcUrl),
      // `confirmed`, not `finalized`: §7 states the depth this surface accepts
      // and why — an agent cannot wait for finality in its critical path.
      currentSlot: async () => BigInt(await new Connection(rpcUrl, "confirmed").getSlot("confirmed")),
    },
    feePayer: (network) => client.feePayerFor(network),
  };
}

interface Body {
  transaction: Uint8Array;
  policy: unknown;
}

function readBody(raw: unknown): Body {
  if (!raw || typeof raw !== "object") throw new PaymentRefused("invalid_request", "the body must be a JSON object");
  const { transaction, policy } = raw as { transaction?: unknown; policy?: unknown };
  if (typeof transaction !== "string" || transaction.length === 0) {
    throw new PaymentRefused("invalid_request", "transaction must be the base64 of a serialized transaction");
  }
  const bytes = Buffer.from(transaction, "base64");
  if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/, "") !== transaction.replace(/=+$/, "")) {
    throw new PaymentRefused("invalid_request", "transaction is not canonical base64");
  }
  if (policy === undefined) {
    throw new PaymentRefused("invalid_request", "policy must be the policy this request is checked against");
  }
  return { transaction: new Uint8Array(bytes), policy };
}

/** One answer, one response. The status is decided upstream; this only renders it. */
function render(answer: Served): NextResponse {
  switch (answer.status) {
    case 200: {
      const headers: Record<string, string> = {};
      if (answer.settlement) {
        headers["PAYMENT-RESPONSE"] = Buffer.from(JSON.stringify(answer.settlement), "utf8").toString("base64");
      }
      return NextResponse.json(
        {
          envelope: answer.envelope,
          chain: {
            seq: answer.stored.seq,
            chainHash: answer.stored.chainHash,
            prevChainHash: answer.stored.prevChainHash,
            appendedAt: answer.stored.appendedAt,
          },
          payment: answer.payment,
        },
        { status: 200, headers },
      );
    }
    case 400:
      return NextResponse.json({ error: answer.code, reason: answer.reason }, { status: 400 });
    case 402: {
      const headers: Record<string, string> = { "PAYMENT-REQUIRED": answer.quote.header };
      if (answer.settlement) {
        headers["PAYMENT-RESPONSE"] = Buffer.from(JSON.stringify(answer.settlement), "utf8").toString("base64");
      }
      // The quote body carries the protocol object AND the binding block. Only
      // the protocol object goes in the header, because the header is what a
      // client echoes and what we forward to the facilitator: the digest stays
      // between this route and the caller who posted the bytes.
      return NextResponse.json({ ...answer.quote.body, reason: answer.reason }, { status: 402, headers });
    }
    case 409:
      return NextResponse.json(
        { error: "payment_in_flight", reason: answer.reason },
        { status: 409, headers: { "Retry-After": String(answer.retryAfterSeconds) } },
      );
    default:
      return NextResponse.json({ error: "unavailable", reason: answer.reason }, { status: 503 });
  }
}

export async function handle(req: Request, deps: RouteDeps): Promise<NextResponse> {
  let config;
  let feePayer: string;
  try {
    config = paymentConfig(deps.ports.env ?? process.env);
    feePayer = await deps.feePayer(config.network);
  } catch (err) {
    // No price, no signing key, no usable facilitator: this route cannot quote,
    // so it says so rather than taking a request it cannot finish.
    if (err instanceof PaymentUnavailable || err instanceof FacilitatorUnusable) {
      return NextResponse.json({ error: "unavailable", reason: err.message }, { status: 503 });
    }
    throw err;
  }

  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "invalid_request", reason: "the body is too large" }, { status: 413 });
    }
    const body = readBody(JSON.parse(text));
    const header = paymentHeader(req);
    const payment = header
      ? readPayment(header, {
          network: config.network,
          amount: config.priceAtomic,
          asset: config.asset,
          payTo: config.payTo,
          maxTimeoutSeconds: config.quoteSeconds,
          feePayer,
        })
      : null;

    return render(
      await serve({ transaction: body.transaction, policy: body.policy, resourceUrl: req.url, feePayer }, payment, deps.ports),
    );
  } catch (err) {
    if (err instanceof PaymentRefused) {
      return NextResponse.json({ error: err.code, reason: err.message }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid_request", reason: "the body is not JSON" }, { status: 400 });
    }
    if (err instanceof PaymentUnavailable || err instanceof FacilitatorUnusable) {
      return NextResponse.json({ error: "unavailable", reason: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "unexpected", reason: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req, productionDeps());
}

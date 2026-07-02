// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { redis, auditKey, QUEUE_KEY } from "../../../../lib/redis";
import { validateSubmission } from "../../../../lib/submission";
import { assertPublicHttpsUrl, SsrfError } from "../../../../lib/ssrf";
import type { AuditRecord } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max 1 audit per hostname per hour (safety §6). */
const RATE_LIMIT_TTL_S = 3600;
const rateKey = (host: string) => `ratelimit:host:${host}`;

export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { ok, errors, value } = validateSubmission(input);
  if (!ok || !value) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  // SSRF guard: resolve DNS and reject private/loopback targets BEFORE enqueue.
  let host: string;
  try {
    const target = await assertPublicHttpsUrl(value.endpoint);
    host = target.hostname.toLowerCase();
  } catch (err) {
    if (err instanceof SsrfError) {
      return NextResponse.json({ errors: [`endpoint rejected: ${err.message}`] }, { status: 400 });
    }
    return NextResponse.json({ error: "endpoint validation failed" }, { status: 400 });
  }

  // Rate limit per hostname (atomic set-if-absent with TTL).
  try {
    const acquired = await redis().set(rateKey(host), new Date().toISOString(), {
      nx: true,
      ex: RATE_LIMIT_TTL_S,
    });
    if (acquired === null) {
      return NextResponse.json(
        { errors: [`rate limited: only one audit per hour per host (${host})`] },
        { status: 429 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `rate-limit check failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const record: AuditRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    form: {
      endpoint: value.endpoint,
      framework: value.framework,
      model: value.model,
      email: value.email,
    },
    protocolConfirmed: value.protocolConfirmed,
    result: null,
  };

  try {
    await redis().set(auditKey(id), record);
    await redis().lpush(QUEUE_KEY, id);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not queue audit: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ auditId: id }, { status: 201 });
}

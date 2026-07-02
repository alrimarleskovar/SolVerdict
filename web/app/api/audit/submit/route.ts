// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { redis, auditKey, QUEUE_KEY } from "../../../../lib/redis";
import { validateForm, mapSetup } from "../../../../lib/mapping";
import type { AuditForm, AuditRecord } from "../../../../lib/types";

// Redis access requires the Node runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { ok, errors } = validateForm(input);
  if (!ok) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const f = input as Record<string, unknown>;
  const form: AuditForm = {
    framework: f.framework as AuditForm["framework"],
    provider: f.provider as AuditForm["provider"],
    target: (f.target as string).trim(),
    email: typeof f.email === "string" && f.email.trim() ? f.email.trim() : undefined,
  };

  const id = randomUUID();
  const now = new Date().toISOString();
  const record: AuditRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    form,
    mappedSetup: mapSetup(form),
    result: null,
  };

  try {
    // Persist the record, then enqueue the id for the worker to pop.
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

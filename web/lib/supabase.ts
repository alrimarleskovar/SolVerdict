// SPDX-License-Identifier: Apache-2.0
/**
 * Supabase clients + the DB-row ↔ AuditRecord mapper (Sprint 5).
 *
 * Replaces the Upstash Redis store. Both the Next.js API routes and the
 * always-on Railway worker talk to Postgres through `supabaseAdmin()` (the
 * service_role key, which bypasses RLS). `supabaseAnon()` is provided for any
 * future client-side read path once RLS + policies are enabled.
 *
 * Clients are created lazily so importing this module never throws at build
 * time when the env is absent (Next.js evaluates route modules during `build`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AuditForm,
  AuditProgress,
  AuditRecord,
  AuditResult,
  AuditStatus,
  AuditTier,
  PaymentInfo,
} from "./types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

/** Service-role client (full read/write, bypasses RLS). Server-only. */
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/** Anon client (subject to RLS). Reserved for future client-side reads. */
export function supabaseAnon(): SupabaseClient {
  if (_anon) return _anon;
  _anon = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _anon;
}

/**
 * Shape of a row from the `audits` table (snake_case, nullable columns as the
 * DB returns them). Kept local — the rest of the app speaks AuditRecord.
 */
export interface AuditRow {
  id: string;
  wallet: string;
  endpoint: string;
  framework: string;
  model: string;
  email: string | null;
  tier: AuditTier;
  status: AuditStatus;
  n: number;
  created_at: string;
  updated_at: string;
  payment_signature: string | null;
  started_at: string | null;
  finished_at: string | null;
  results: AuditResult | null;
  progress: AuditProgress | null;
  error: string | null;
}

/** Map a DB row into the wire-facing AuditRecord. */
export function rowToRecord(row: AuditRow): AuditRecord {
  const form: AuditForm = {
    endpoint: row.endpoint,
    framework: row.framework,
    model: row.model,
    ...(row.email ? { email: row.email } : {}),
  };

  const rec: AuditRecord = {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    form,
    walletPubkey: row.wallet,
    tier: row.tier,
    n: row.n,
    result: row.results ?? null,
  };

  if (row.tier === "paid") {
    const payment: PaymentInfo = {
      expectedUsdc: PAID_AMOUNT_USDC,
      destination: process.env.SOLVERDICT_PAYMENT_WALLET ?? "",
    };
    if (row.payment_signature) {
      payment.signature = row.payment_signature;
      payment.verifiedAt = row.updated_at;
    }
    rec.payment = payment;
  }

  if (row.progress) rec.progress = row.progress;
  if (row.error) rec.error = row.error;
  return rec;
}

/** 10 USDC for a paid N=20 audit (mirrors lib/payment.ts). */
const PAID_AMOUNT_USDC = 10;

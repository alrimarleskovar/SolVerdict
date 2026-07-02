// SPDX-License-Identifier: Apache-2.0
/**
 * Sprint 1 stand-in mapping: the submitted (framework, provider) pair is mapped
 * to a PUBLISHED reference setup that the audit-worker actually runs. There is
 * no live external-endpoint adapter yet (that is Sprint 2) — so an "SAK +
 * Anthropic" submission is benched with the `sak-claude` reference setup, etc.
 * The status page surfaces which setup ran so this is never presented as if the
 * submitter's own binary was executed.
 */
import type { AuditForm, Framework, Provider } from "./types";

/** Published parent setup ids (setups/index.ts SETUPS). */
export type ReferenceSetup =
  | "sak-claude"
  | "sak-gpt"
  | "model-only-claude"
  | "baseline-scripted";

export function mapSetup(form: Pick<AuditForm, "framework" | "provider">): ReferenceSetup {
  const { framework, provider } = form;
  if (framework === "sak") {
    return provider === "openai" ? "sak-gpt" : "sak-claude";
  }
  // custom / other framework: fall back to the closest published reference.
  // Anthropic -> model-only-claude (framework-free reference); OpenAI/other ->
  // sak-gpt as the nearest GPT-backed setup we can actually execute.
  if (provider === "anthropic") return "model-only-claude";
  if (provider === "openai") return "sak-gpt";
  return "model-only-claude";
}

const FRAMEWORKS: Framework[] = ["sak", "custom", "other"];
const PROVIDERS: Provider[] = ["anthropic", "openai", "other"];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Server-side validation of the submitted form. Cheap, dependency-free. */
export function validateForm(input: unknown): ValidationResult {
  const errors: string[] = [];
  const f = (input ?? {}) as Record<string, unknown>;

  if (!FRAMEWORKS.includes(f.framework as Framework)) {
    errors.push("framework must be one of: sak, custom, other");
  }
  if (!PROVIDERS.includes(f.provider as Provider)) {
    errors.push("provider must be one of: anthropic, openai, other");
  }
  const target = typeof f.target === "string" ? f.target.trim() : "";
  if (target.length === 0) {
    errors.push("target (agent endpoint or GitHub repo URL) is required");
  } else if (!/^https?:\/\/.+/i.test(target)) {
    errors.push("target must be an http(s) URL");
  }
  if (f.email !== undefined && f.email !== "" && f.email !== null) {
    if (typeof f.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      errors.push("email, if provided, must be a valid address");
    }
  }

  return { ok: errors.length === 0, errors };
}

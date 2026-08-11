// SPDX-License-Identifier: Apache-2.0
/**
 * Submit-form validation (synchronous, dependency-free).
 *
 * There is no endpoint rule here any more, and no SSRF screen: the form stopped
 * collecting a URL when the remote executor was deleted. SolVerdict never dials
 * the agent — the audit runs on the customer's machine and only the signed
 * evidence bundle travels here — so a URL field could only be an unverified
 * string displayed as if it meant something. `framework` and `model` are what
 * the customer declares; the agent id is read from the bundle they sign.
 *
 * ssrf.ts is still present and still correct, with no callers. See its header.
 */

export interface Submission {
  framework: string;
  model: string;
  email?: string;
  protocolConfirmed: boolean;
}

export interface ValidatedSubmission {
  ok: boolean;
  errors: string[];
  value?: Submission;
}

const MAX_NAME = 100;

export function validateSubmission(input: unknown): ValidatedSubmission {
  const errors: string[] = [];
  const f = (input ?? {}) as Record<string, unknown>;

  const framework = typeof f.framework === "string" ? f.framework.trim() : "";
  if (!framework) errors.push("framework name is required");
  else if (framework.length > MAX_NAME) errors.push("framework name too long");

  const model = typeof f.model === "string" ? f.model.trim() : "";
  if (!model) errors.push("model name is required");
  else if (model.length > MAX_NAME) errors.push("model name too long");

  let email: string | undefined;
  if (f.email !== undefined && f.email !== null && f.email !== "") {
    if (typeof f.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      errors.push("email, if provided, must be a valid address");
    } else {
      email = f.email.trim();
    }
  }

  if (f.protocolConfirmed !== true) {
    errors.push("you must confirm your agent implements the SolVerdict Audit Protocol");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: { framework, model, email, protocolConfirmed: true },
  };
}

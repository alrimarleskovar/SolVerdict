// SPDX-License-Identifier: Apache-2.0
/**
 * Submit-form validation (synchronous, dependency-free). The async SSRF/DNS
 * check lives in ssrf.ts and runs in the API route before enqueue.
 */
import { looksLikePrivateHostname } from "./ssrf";

export interface Submission {
  endpoint: string;
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

  const endpoint = typeof f.endpoint === "string" ? f.endpoint.trim() : "";
  if (!endpoint) {
    errors.push("agent endpoint URL is required");
  } else {
    let url: URL | null = null;
    try {
      url = new URL(endpoint);
    } catch {
      errors.push("endpoint is not a valid URL");
    }
    if (url) {
      if (url.protocol !== "https:") errors.push("endpoint must use https");
      if (url.username || url.password) errors.push("endpoint must not contain credentials");
      if (looksLikePrivateHostname(url.hostname)) {
        errors.push("endpoint must be a public host (no localhost / private IPs)");
      }
    }
  }

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
    value: { endpoint, framework, model, email, protocolConfirmed: true },
  };
}

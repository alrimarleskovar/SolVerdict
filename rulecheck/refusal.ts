// SPDX-License-Identifier: Apache-2.0
/**
 * A request the rulecheck will not answer. A refusal is not a record: it has
 * no binding, no states, and says nothing about the transaction. It exists so
 * that bad input can never come back looking like a clean result.
 */
export type RefusalCode =
  | "undecodable-transaction"
  | "non-canonical-transaction"
  | "invalid-policy"
  | "invalid-slot"
  | "subject-mismatch";

export class RulecheckRefusal extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "RulecheckRefusal";
  }
}

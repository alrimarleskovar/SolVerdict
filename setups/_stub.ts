// SPDX-License-Identifier: Apache-2.0
/**
 * Stub factory for setups whose interface exists but whose integration is not
 * yet wired. A stub throws on run() so the bench runner skips it and reports
 * it honestly as not-yet-integrated — it never silently produces fake numbers.
 */
import type { Setup } from "../lib/types.js";

export function makeStub(id: string, description: string, blocker: string): Setup {
  return {
    id,
    status: "not-yet-integrated",
    description: `${description} — NOT YET INTEGRATED: ${blocker}`,
    async run() {
      throw new Error(`[${id}] not yet integrated: ${blocker}`);
    },
  };
}

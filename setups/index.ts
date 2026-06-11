// SPDX-License-Identifier: Apache-2.0
/** Setup registry, in prereg §7 order. selftest-scripted is a harness self-test, not a published setup. */
import type { Setup } from "../lib/types.js";
import baseline from "./baseline-scripted.js";
import modelOnly from "./model-only-claude.js";
import sakClaude from "./sak-claude.js";
import sakGpt from "./sak-gpt.js";
import sakClaudeOnlyfence from "./sak-claude-onlyfence.js";
import elizaClaude from "./eliza-claude.js";
import rigClaude from "./rig-claude.js";
import selftest from "./selftest-scripted.js";

/**
 * Published setups (prereg §7), in committed order: the scripted floor, the
 * model-only reference, then the four frameworks.
 */
export const SETUPS: Setup[] = [baseline, modelOnly, sakClaude, sakGpt, sakClaudeOnlyfence, elizaClaude, rigClaude];

/** Harness self-test setup — excluded from the published board. */
export const SELFTEST_SETUPS: Setup[] = [selftest];

export const ALL_SETUPS: Setup[] = [...SETUPS, ...SELFTEST_SETUPS];

export function getSetup(id: string): Setup | undefined {
  return ALL_SETUPS.find((s) => s.id === id);
}

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
import modelOnlyGemini from "./model-only-gemini.js";
import sakGemini from "./sak-gemini.js";

/**
 * Published setups (prereg §7), in committed order: the scripted floor, the
 * model-only reference, then the four frameworks.
 */
export const SETUPS: Setup[] = [baseline, modelOnly, sakClaude, sakGpt, sakClaudeOnlyfence, elizaClaude, rigClaude];

/** Harness self-test setup — excluded from the published board. */
export const SELFTEST_SETUPS: Setup[] = [selftest];

/**
 * SMOKE-ONLY setups (prereg v0.3.0 §7): free-tier Gemini, used to exercise
 * scenarios and the harness cheaply. Excluded from the published board and
 * never comparable to roster results — the model is chosen by price, not by
 * the §7 adoption criterion.
 */
export const SMOKE_SETUPS: Setup[] = [modelOnlyGemini, sakGemini];

export const ALL_SETUPS: Setup[] = [...SETUPS, ...SELFTEST_SETUPS, ...SMOKE_SETUPS];

export function getSetup(id: string): Setup | undefined {
  return ALL_SETUPS.find((s) => s.id === id);
}

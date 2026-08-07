// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical name/tagline/link strings for the RENDERED report surfaces (the
 * leaderboard HTML reads BRANDING.name). The project name ALSO appears as prose,
 * identifiers and metadata across the repo (README, prereg, NOTICE, package.json,
 * code comments) — a rename is a global search/replace, not a one-line edit here.
 * "SolVerdict" is the chosen, verified project name.
 */
import { PREREG } from "./prereg.js";

export const BRANDING = {
  name: "SolVerdict",
  workingTitle: false,
  tagline: "Does your Solana agent contain the failure — or execute it?",
  description:
    "Open, reproducible safety benchmark for AI agents that operate Solana wallets. " +
    `${PREREG.scenarios} adversarial scenarios, ${PREREG.categories} categories, ` +
    "objective machine-checked scoring on a local mainnet fork.",
  repoUrl: "https://github.com/alrimarleskovar/SolVerdict",
  maintainer: "Alrimar Sobrinho",
  contact: "open a GitHub issue at https://github.com/alrimarleskovar/SolVerdict/issues",
  /** Sourced from config/prereg.ts so the three stamps can never drift again. */
  preregFile: PREREG.file,
  githubTopics: ["solana", "ai-agents", "safety", "benchmark", "security"],
} as const;

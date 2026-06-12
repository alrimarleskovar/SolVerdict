// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical name/tagline/link strings for the RENDERED report surfaces (the
 * leaderboard HTML reads BRANDING.name). The project name ALSO appears as prose,
 * identifiers and metadata across the repo (README, prereg, NOTICE, package.json,
 * code comments) — a rename is a global search/replace, not a one-line edit here.
 * "SolVerdict" is the chosen, verified project name.
 */
export const BRANDING = {
  name: "SolVerdict",
  workingTitle: false,
  tagline: "Does your Solana agent contain the failure — or execute it?",
  description:
    "Open, reproducible safety benchmark for AI agents that operate Solana wallets. " +
    "14 adversarial scenarios, 5 categories, objective machine-checked scoring on a local mainnet fork.",
  repoUrl: "https://github.com/alrimarleskovar/TripWire",
  maintainer: "Alrimar Sobrinho",
  contact: "open a GitHub issue at https://github.com/alrimarleskovar/TripWire/issues",
  preregFile: "tripwire-prereg-v0.2.1.md",
  githubTopics: ["solana", "ai-agents", "safety", "benchmark", "security"],
} as const;

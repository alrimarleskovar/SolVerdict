// SPDX-License-Identifier: Apache-2.0
/**
 * ALL name/tagline/link strings live HERE and only here, so the project can be
 * renamed in one place. "Tripwire" is a working title and has NOT been
 * verified as available — do not treat it as final.
 */
export const BRANDING = {
  name: "Tripwire",
  workingTitle: true,
  tagline: "Does your Solana agent contain the failure — or execute it?",
  description:
    "Open, reproducible safety benchmark for AI agents that operate Solana wallets. " +
    "14 adversarial scenarios, 5 categories, objective machine-checked scoring on a local mainnet fork.",
  repoUrl: "[REPO_URL]",
  maintainer: "[MAINTAINER]",
  contact: "[CONTACT]",
  preregFile: "tripwire-prereg-v0.md",
  githubTopics: ["solana", "ai-agents", "safety", "benchmark", "security"],
} as const;

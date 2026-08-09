// SPDX-License-Identifier: Apache-2.0
/**
 * Shared constants for the @solverdict/sak-adapter callouts (/submit and
 * /docs/protocol). Step 8: the quickstart shows the LOCAL runner — the
 * `createAuditHandler` HTTP shape it used to show has no consumer.
 *
 * Plain module (no "use client") so both server and client components can
 * import the strings. The quickstart snippet is technical
 * content and stays verbatim in both languages (lib/i18n policy).
 */
import { BRANDING } from "../../config/branding";

export const SAK_ADAPTER_NPM_URL = "https://www.npmjs.com/package/@solverdict/sak-adapter";
export const SAK_ADAPTER_README_URL = `${BRANDING.repoUrl}/tree/main/packages/sak-adapter`;
export const SAK_ADAPTER_INSTALL = "npm install @solverdict/sak-adapter";

export const SAK_ADAPTER_QUICKSTART = `import { runSakAudit } from "@solverdict/sak-adapter";

// my-agent.mjs — the harness runs this locally, one scenario at a time.
export default {
  id: "my-agent",
  run: (input, wallet, rpcUrl) =>
    runSakAudit(agent, {                   // your existing SolanaAgentKit
      scenarioId: input.scenarioId,
      walletPubkey: wallet.publicKey.toBase58(),
      rpcUrl,                              // your local fork
      scenarioInput: input,
    }, {}),
};`;

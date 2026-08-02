// SPDX-License-Identifier: Apache-2.0
/**
 * Shared constants for the @solverdict/sak-adapter callouts (/submit and
 * /docs/protocol). Plain module (no "use client") so both server and client
 * components can import the strings. The quickstart snippet is technical
 * content and stays verbatim in both languages (lib/i18n policy).
 */
import { BRANDING } from "../../config/branding";

export const SAK_ADAPTER_NPM_URL = "https://www.npmjs.com/package/@solverdict/sak-adapter";
export const SAK_ADAPTER_README_URL = `${BRANDING.repoUrl}/tree/main/packages/sak-adapter`;
export const SAK_ADAPTER_INSTALL = "npm install @solverdict/sak-adapter";

export const SAK_ADAPTER_QUICKSTART = `import { createAuditHandler } from "@solverdict/sak-adapter";

const handler = createAuditHandler(agent); // your existing SolanaAgentKit
app.post("/audit", handler.node);          // Express / node:http
// Next.js App Router: export const POST = handler.fetch;`;

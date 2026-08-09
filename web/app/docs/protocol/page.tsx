// SPDX-License-Identifier: Apache-2.0
/**
 * /docs/protocol — how an audit is run and submitted.
 *
 * REWRITTEN IN STEP 8. This page used to document an HTTP contract: implement
 * an endpoint, we POST each scenario to it, you return unsigned transactions.
 * That contract is deleted. It could not survive the local-adapter migration
 * for a concrete reason worth stating on the page itself — the request carried
 * `rpcUrl: "http://localhost:8899"`, which named OUR fork and resolved on YOUR
 * machine. The audit now runs where the agent already runs, and only the
 * evidence travels.
 *
 * Landing design system unchanged: ink cards + SectionHeading/Reveal, full
 * shell width, JetBrains Mono for protocol strings, de-synchronized breathing
 * borders (.doc-card).
 */
import { PREREG } from "../../../../config/prereg";
import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { InnerPageShell } from "../../../components/InnerPageShell";
import { Reveal, SectionHeading } from "../../../components/landing/ui";
import { InstallCommand } from "../../../components/SakAdapterCallout";
import { BRANDING } from "../../../../config/branding";
import { LANG_COOKIE, parseLang, t } from "../../../lib/i18n";
import {
  SAK_ADAPTER_NPM_URL,
  SAK_ADAPTER_QUICKSTART,
  SAK_ADAPTER_README_URL,
} from "../../../lib/sak-adapter";
import { PROTOCOL_VERSION, MAX_BUNDLE_BYTES, ABUSE_CONTACT } from "../../../lib/audit-protocol";

export const metadata: Metadata = {
  title: "SolVerdict Submission Protocol",
  description: "How a Solana agent is audited locally and how the evidence bundle is submitted for scoring.",
};

const RUN_EXAMPLE = `# 1. install the harness (it brings the scenarios and the fork tooling)
npm install @solverdict/harness

# 2. run YOUR agent against the instance issued for YOUR audit
npx solverdict-run \\
  --agent ./my-agent.mjs \\
  --audit <auditId> \\
  --instance ./instance.json`;

const AGENT_EXAMPLE = `// my-agent.mjs — default-export a Setup. No SolVerdict types required.
export default {
  id: "my-agent",
  async run(input, wallet, rpcUrl, ctx) {
    // input.task        the scenario's instruction
    // input.context     untrusted context around it (injected data, messages)
    // wallet            an ephemeral funded Keypair — never your real key
    // rpcUrl            your local fork: http://localhost:8899
    //
    // Drive your agent however you already do. Transactions it submits to
    // rpcUrl are recorded; nothing reaches a real network.
    const actions = await myAgent.handle(input.task, { wallet, rpcUrl });

    return { actions, finalText: "…", ok: true, settings: { framework: "my-stack" } };
  },
};`;

const MANIFEST_EXAMPLE = `{
  "format": "${PROTOCOL_VERSION}",
  "auditId": "b387c4ea-07bd-4b9d-b4c7-e849747a3f7a",
  "runId": "2026-08-09T230339Z",
  "producedBy": "@solverdict/harness",
  "preregVersion": "${PREREG.version}",
  "preregSha256": "sha256:…",
  "bundle": { "file": "2026-08-09T230339Z.tar.gz", "bytes": 21520, "sha256": "…" },
  "cells": ["A1#0", "A2#0", "…"]
}`;

const SUBMIT_EXAMPLE = `# The harness prints the manifest digest. Sign THAT with the wallet that
# owns the audit (your wallet signs 64 hex characters, not a 20 MB file —
# the manifest commits to the archive's sha256, so it commits to every byte).

curl -X POST https://solverdict.vercel.app/api/audit/<auditId>/evidence \\
  -F bundle=@2026-08-09T230339Z.tar.gz \\
  -F manifest=@2026-08-09T230339Z.manifest.json \\
  -F signature=<base58 ed25519 signature>`;

/** Code block: JetBrains Mono on the ink surface. Long lines WRAP (pre-wrap +
 *  break-words) instead of scrolling — no horizontal scrollbar, the block
 *  grows taller as needed and never widens the card or the page. */
function Code({ children }: { children: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-xl border border-ink-line bg-ink p-4 font-code text-[13px] leading-relaxed text-snow/80">
      <code className="block border-0 bg-transparent p-0">{children}</code>
    </pre>
  );
}

/** Documentation card: ink surface + breathing border, phase-shifted per index. */
function DocCard({
  title,
  index,
  className,
  children,
}: {
  title: string;
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Reveal delay={0.05 * (index % 3)} className={className}>
      <section
        className="doc-card h-full rounded-2xl border border-ink-line bg-ink-card/60 p-6 shadow-lg shadow-black/20 sm:p-8"
        style={{ "--card-i": index } as CSSProperties}
      >
        <h2 className="font-display text-lg font-bold tracking-tight text-snow">{title}</h2>
        <div className="mt-4">{children}</div>
      </section>
    </Reveal>
  );
}

export default function ProtocolDocs() {
  // Cookie read keeps this page consistent with the dynamic (per-language) app;
  // the protocol spec / code samples stay verbatim in both languages (only the
  // sak-adapter card's prose is translated).
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);

  return (
    <InnerPageShell>
      <div className="pt-8">
        <SectionHeading
          as="h1"
          eyebrow={PROTOCOL_VERSION}
          title="SolVerdict Submission Protocol"
          titleMax="max-w-none"
        />
        <Reveal delay={0.1}>
          <p className="mt-6 max-w-none text-base leading-relaxed text-mist">
            You run the audit. The harness drives your agent through all {PREREG.scenarios} scenarios on a mainnet fork
            on your own machine, records what it does, and packages the evidence. You submit that bundle;{" "}
            <strong className="text-snow">SolVerdict scores it server-side</strong>. Your agent never holds a real key
            and never touches a real network.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6">
          {/* Recommended path for SAK agents: the adapter wires an existing
              SolanaAgentKit into the local runner, so those developers can
              stop after the install. */}
          <DocCard title={t(lang, "sakad.docs.title")} index={0}>
            <p className="text-sm leading-relaxed text-mist">{t(lang, "sakad.docs.body")}</p>
            <div className="mt-4 grid gap-3">
              <InstallCommand />
              <Code>{SAK_ADAPTER_QUICKSTART}</Code>
            </div>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              <a
                href={SAK_ADAPTER_NPM_URL}
                target="_blank"
                rel="noreferrer"
                className="font-code text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow"
              >
                {t(lang, "sakad.npm")} ↗
              </a>
              <a
                href={SAK_ADAPTER_README_URL}
                target="_blank"
                rel="noreferrer"
                className="font-code text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow"
              >
                {t(lang, "sakad.readme")} ↗
              </a>
            </p>
          </DocCard>

          <DocCard title="Why it runs on your machine" index={1}>
            <ul className="w-full max-w-none space-y-3 text-sm leading-relaxed text-mist">
              <li>
                An audit needs your agent and a Solana fork on the{" "}
                <strong className="text-snow">same host</strong>. The fork is at{" "}
                <code>http://localhost:8899</code> — which, on our infrastructure, is a loopback address your agent
                could never reach. So the audit runs where your agent already runs.
              </li>
              <li>
                <strong className="text-snow">We never see your agent, your prompts or your keys.</strong> Only the
                evidence bundle is uploaded: the transactions your agent submitted, the RPC calls it made, and the
                actions it logged.
              </li>
              <li>
                <strong className="text-snow">You cannot score your own audit.</strong> The pass/fail rules, the
                thresholds and the aggregation are server-side and are not published in the harness — a CI guard fails
                the build if any of them become reachable from the client package.
              </li>
              <li>
                Each paid audit gets its <strong className="text-snow">own instance</strong>: destination addresses and
                Token-2022 mints derived from a seed only the server holds. You cannot have optimised against
                addresses that did not exist before you asked for them.
              </li>
            </ul>
          </DocCard>

          <DocCard title="1 · Run the audit" index={2}>
            <Code>{RUN_EXAMPLE}</Code>
          </DocCard>

          <DocCard title="2 · Your agent is one function" index={3}>
            <Code>{AGENT_EXAMPLE}</Code>
          </DocCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <DocCard title="3 · The manifest" index={4}>
              <Code>{MANIFEST_EXAMPLE}</Code>
            </DocCard>
            <DocCard title="4 · Submit it" index={5}>
              <Code>{SUBMIT_EXAMPLE}</Code>
            </DocCard>
          </div>

          <DocCard title="What the server checks before it scores" index={6}>
            <ul className="w-full max-w-none space-y-3 text-sm leading-relaxed text-mist">
              <li>
                <strong className="text-snow">Integrity</strong> — the archive&apos;s SHA-256 matches the manifest.
              </li>
              <li>
                <strong className="text-snow">Ownership</strong> — the manifest digest is signed by the wallet that
                owns the audit. A signature for one audit cannot submit evidence for another.
              </li>
              <li>
                <strong className="text-snow">Methodology</strong> — the harness declares the pre-registration digest
                it implements, and it must match the document we hold.
              </li>
              <li>
                <strong className="text-snow">Instance</strong> — every run&apos;s parameters must be the ones issued
                for your audit. You cannot report a mint you were never given.
              </li>
              <li>
                Then every verdict is <strong className="text-snow">re-derived</strong>: transaction amounts are
                recomputed from the validator&apos;s own pre/post balances, destinations and program ids are decoded
                from the signed bytes, and the denominator is the N your audit committed to — a short submission scores
                as <em>incomplete</em>, not as a better average.
              </li>
              <li>
                Any check that fails is a <strong className="text-snow">refusal</strong>, never a warning. Bundle cap:{" "}
                <strong className="text-snow">{MAX_BUNDLE_BYTES / 1024 / 1024} MB</strong>. One submission per audit.
              </li>
            </ul>
          </DocCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <DocCard title="What this does not prove" index={7}>
              <p className="text-sm leading-relaxed text-mist">
                Verification proves you used the instance you were issued and that the evidence was not altered after
                signing. It does <strong className="text-snow">not</strong> prove you ran an unmodified harness —
                anyone executing an audit on their own machine could, in principle, interfere with the run. That is
                inherent to local execution and needs attestation, which is not implemented. It is declared in{" "}
                <a
                  href={`${BRANDING.repoUrl}/blob/main/tripwire-prereg-${PREREG.version}.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-code text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow"
                >
                  §2.6 of the pre-registration
                </a>{" "}
                rather than glossed over.
              </p>
            </DocCard>

            <DocCard title="Abuse" index={8}>
              <p className="text-sm leading-relaxed text-mist">
                If the harness misbehaves on your machine, or you want to report a flaw in the submission protocol:{" "}
                <a
                  href={ABUSE_CONTACT}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-code text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow"
                >
                  {ABUSE_CONTACT}
                </a>
                .
              </p>
            </DocCard>
          </div>
        </div>

        <Reveal delay={0.1}>
          <p className="mt-12">
            <Link
              href="/submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-accent-blue to-accent-violet px-6 py-3 text-base font-semibold text-snow shadow-lg shadow-black/20 transition-all duration-200 ease-brand hover:-translate-y-px hover:shadow-black/40 sm:w-auto"
            >
              Submit your agent →
            </Link>
          </p>
        </Reveal>
      </div>
    </InnerPageShell>
  );
}

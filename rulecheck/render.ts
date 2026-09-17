// SPDX-License-Identifier: Apache-2.0
/**
 * Plain-text rendering of a rulecheck record.
 *
 * Deliberately plain (RULECHECK.md §1, §3): no colour, no ticks, no badge, no
 * summary line. Each rule shows its own state word and nothing reduces the
 * list. The coverage statement comes first and the §9 limit comes last, and
 * neither is optional.
 *
 * `opaque` receives every address and digest. Rendering with it replaced by a
 * constant yields the record's prose alone, which is what the vocabulary
 * matcher reads.
 */
import type { RulecheckRecord } from "./rulecheck.js";

export interface RenderOptions {
  opaque?: (value: string) => string;
  width?: number;
}

function wrap(text: string, indent: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

export function renderRecord(record: RulecheckRecord, opts: RenderOptions = {}): string {
  const o = opts.opaque ?? ((v: string) => v);
  const width = opts.width ?? 100;
  const b = record.binding;
  const t = record.transaction;
  const out: string[] = [];

  out.push(`SolVerdict Rulecheck record (${record.format})`, "");
  out.push(...wrap(record.coverage, "", width), "");

  for (const r of record.results) {
    out.push(`rule ${r.rule}  (derived from ${r.derivedFrom}, rule version ${r.ruleVersion})`);
    out.push(`  state: ${r.state}`);
    out.push(...wrap(r.statement, "  ", width));
    out.push(`  approveLimit = ${r.parameters.approveLimit} token base units, the same for every mint`);
    out.push("");
    for (const ob of r.observations) {
      out.push(`  #${ob.instruction}  program ${o(ob.programId)}  (decoder kind: ${ob.instructionKind})`);
      out.push(...wrap(`${ob.finding} — ${ob.note}`, "      ", width));
      if (ob.authority) out.push(`      authorised by: ${ob.authority.map(o).join(", ")}`);
    }
    if (r.observations.length === 0) out.push("  (the message has no outer instructions)");
    out.push("");
  }

  const lookups =
    t.lookupTables === 0
      ? "no lookup tables"
      : `${t.lookupTables} lookup table(s) supplying ${t.lookupAccounts} account(s), not resolved`;
  out.push("binding");
  out.push(`  digest          sha256:${o(b.digest)}  (encoding ${b.encoding})`);
  out.push(`  message         sha256:${o(b.messageSha256)}`);
  out.push(`                  ${b.messageBytes} bytes, ${t.messageVersion}, ${t.outerInstructions} outer instruction(s), ${lookups}`);
  out.push(`  policy          ${b.policyId} v${record.policy.version}  sha256:${o(b.policyVersionDigest)}`);
  out.push(`  slot            ${b.slot}`);
  out.push("");
  out.push(`subject           ${o(record.policy.subject)}  (from the policy; a request cannot set it)`);
  out.push("policy anchor     none (this build has no registry, so the policy is not anchored on-chain)");
  out.push(`accounts read     ${record.accountsRead.length === 0 ? "none" : record.accountsRead.length}`);
  out.push("record age        not known here (this command has no chain connection);");
  out.push(`                  the record holds at slot ${b.slot} and says nothing about any later slot`);
  out.push("");
  out.push(...wrap(record.limit, "", width));
  return `${out.join("\n")}\n`;
}

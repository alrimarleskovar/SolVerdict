// SPDX-License-Identifier: Apache-2.0
/**
 * Rulecheck one serialized transaction against a policy file.
 *
 *   npx tsx rulecheck/cli.ts --policy <policy.json> --slot <n> [options] <tx-file | ->
 *
 *   --encoding base64|base58   how the transaction file is written (default base64)
 *   --subject <address>        optional; refused unless it equals the policy's subject
 *   --json                     print the record as JSON instead of text
 *
 * Exit status 0 means a record was produced, whatever its states: a record is a
 * list of per-rule states, and the process does not reduce it to one bit.
 * 2 means the request was refused (bytes, policy, slot or subject); 1 means the
 * command was used wrongly.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import bs58 from "bs58";
import { parsePolicy } from "./policy.js";
import { RulecheckRefusal } from "./refusal.js";
import { renderRecord } from "./render.js";
import { rulecheck } from "./rulecheck.js";
import { assertVocabulary } from "./vocabulary.js";

const USAGE =
  "usage: npx tsx rulecheck/cli.ts --policy <policy.json> --slot <n> " +
  "[--encoding base64|base58] [--subject <address>] [--json] <tx-file | ->";

function usage(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

function decodeTransaction(text: string, encoding: string): Uint8Array {
  const s = text.trim();
  if (encoding === "base64") {
    // Buffer.from skips characters it does not know; insist on a clean round trip.
    const bytes = Buffer.from(s, "base64");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || bytes.toString("base64") !== s) {
      throw new RulecheckRefusal("undecodable-transaction", "the input is not canonical base64");
    }
    return bytes;
  }
  if (encoding === "base58") {
    try {
      return bs58.decode(s);
    } catch {
      throw new RulecheckRefusal("undecodable-transaction", "the input is not base58");
    }
  }
  return usage(`unknown --encoding ${encoding}`);
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        policy: { type: "string" },
        slot: { type: "string" },
        encoding: { type: "string", default: "base64" },
        subject: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    usage((err as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!values.policy) usage("--policy is required");
  if (!values.slot) usage("--slot is required");
  if (positionals.length !== 1) usage("exactly one transaction file is required ('-' reads stdin)");

  try {
    let policyJson: unknown;
    try {
      policyJson = JSON.parse(readFileSync(values.policy, "utf8"));
    } catch (err) {
      throw new RulecheckRefusal("invalid-policy", `cannot read ${values.policy} as JSON (${(err as Error).message})`);
    }
    const policy = parsePolicy(policyJson);

    if (!/^(0|[1-9][0-9]*)$/.test(values.slot)) {
      throw new RulecheckRefusal("invalid-slot", `slot "${values.slot}" is not a decimal integer`);
    }
    const slot = BigInt(values.slot);

    let source: string;
    try {
      source = readFileSync(positionals[0] === "-" ? 0 : positionals[0], "utf8");
    } catch (err) {
      return usage(`cannot read ${positionals[0]} (${(err as Error).message})`);
    }
    const transaction = decodeTransaction(source, values.encoding ?? "base64");

    const record = rulecheck({ transaction, policy, slot, namedSubject: values.subject });

    if (values.json) {
      process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
      return;
    }
    assertVocabulary("rendered record", renderRecord(record, { opaque: () => "#" }));
    process.stdout.write(renderRecord(record));
  } catch (err) {
    if (err instanceof RulecheckRefusal) {
      console.error(`refused — ${err.message}`);
      console.error("no record was produced.");
      process.exit(2);
    }
    throw err;
  }
}

main();

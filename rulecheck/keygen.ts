#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Generates a record signing key and prints what to do with each half.
 *
 *   npm run rulecheck:keygen -- --key-id rk1
 *
 * WRITES NOTHING. The seed is printed once, to stdout, and never touched by
 * this repository again: it belongs in the deployment's environment, and a
 * generator that helpfully wrote it to a file would put the one secret that can
 * sign records into a working tree. The public half is printed as the registry
 * entry to paste into keys.ts, where it is meant to be committed.
 *
 * Run it on a machine you trust, and do not paste the seed into a chat, a
 * ticket or a shell history you keep. Rotation is two environment values and
 * one appended entry, so replacing a key you are unsure about is cheap.
 */
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { publicKeyForSeed } from "./envelope.js";
import { RECORD_KEYS, problemsIn } from "./keys.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const keyId = arg("key-id") ?? `rk${RECORD_KEYS.length + 1}`;
const seed = randomBytes(32);
const publicKey = publicKeyForSeed(seed);
const today = new Date().toISOString().slice(0, 10);

const entry = `  { keyId: ${JSON.stringify(keyId)}, publicKey: ${JSON.stringify(publicKey)}, from: ${JSON.stringify(today)} },`;

const problems = problemsIn([...RECORD_KEYS, { keyId, publicKey, from: today }]);

console.log(`
A record signing key, generated ${today}.

1. Into the deployment environment (secret, server-only, never NEXT_PUBLIC_):

   RULECHECK_RECORD_KEY_ID=${keyId}
   RULECHECK_RECORD_SIGNING_SEED=${bs58.encode(seed)}

2. Into rulecheck/keys.ts, appended to RECORD_KEYS (public, committed):

${entry}

3. Commit the entry BEFORE the deployment signs anything with the seed: a
   record naming a key id the published registry does not carry cannot be
   verified by the reader it was issued for.

The seed above is not stored anywhere by this command. If it is lost, rotate:
generate another key, append its entry, and set "until": "<date>" on this one.
Records already issued stay verifiable under the old entry.
`);

if (problems.length > 0) {
  console.error(`This entry would make the registry incoherent:\n  ${problems.join("\n  ")}`);
  process.exit(2);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Regression guard for the surfnet WebSocket-port trap.
 *
 * Bug (found by the v0.3.0 Gemini smoke run): `env/token2022.ts` built a
 * web3.js `Connection` to the internal surfnet port (:8999) and confirmed
 * fixture transactions with `sendAndConfirmTransaction`. That confirms via
 * `signatureSubscribe`, i.e. over the WebSocket — and web3.js derives the ws
 * endpoint from the http one by adding 1 to the port (`makeWebsocketUrl`), so
 * it dialed :9000. Surfpool binds its ws server to its own default :8900
 * (env/surfpool.ts passes `--port` but never `--ws-port`), so :9000 refused the
 * connection, confirmation never arrived, and every category-F fixture died
 * with TransactionExpiredBlockheightExceededError after repeated
 * "ws error: connect ECONNREFUSED 127.0.0.1:9000".
 *
 * These assertions are pure — no network, no surfpool, no keys. They pin the
 * two properties that made the bug possible, so it cannot silently return.
 */
import { readFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";
import { SURFPOOL_INTERNAL_URL, SURFPOOL_WS_URL } from "./rpc.js";

let failures = 0;
let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name}\n  ${(err as Error).message}`);
  }
}
function expect(actual: unknown) {
  return {
    toBe(want: unknown): void {
      if (actual !== want) throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    },
  };
}

/** web3.js keeps the resolved ws endpoint here; read it to prove what it dials. */
const wsOf = (c: Connection): string => (c as unknown as { _rpcWsEndpoint: string })._rpcWsEndpoint;

test("the surfnet ws constant points at surfpool's actual ws port (8900)", () => {
  expect(new URL(SURFPOOL_WS_URL).port).toBe("8900");
});

test("web3.js default derivation is the trap: :8999 -> ws :9000 (nothing listens)", () => {
  // Documents WHY the explicit endpoint is required. If a future web3.js drops
  // the +1 convention this flips, and the explicit endpoint stays correct.
  expect(new URL(wsOf(new Connection(SURFPOOL_INTERNAL_URL))).port).toBe("9000");
});

test("an explicit wsEndpoint overrides the derived port", () => {
  const c = new Connection(SURFPOOL_INTERNAL_URL, { commitment: "confirmed", wsEndpoint: SURFPOOL_WS_URL });
  expect(new URL(wsOf(c)).port).toBe("8900");
  expect(c.rpcEndpoint).toBe(SURFPOOL_INTERNAL_URL);
});

// The confirm loop now lives in env/setup-tx.ts, which every harness setup
// transaction goes through — fixture mints and delegated allowances alike. The
// guard follows the code rather than the filename: whichever module confirms,
// it must confirm over HTTP, and neither may reach for the ws-backed helper.
for (const file of ["./token2022.ts", "./setup-tx.ts", "./delegation.ts"]) {
  test(`${file} never IMPORTS the ws-backed confirm helper`, () => {
    // sendAndConfirmTransaction is the ws-backed path that caused the bug.
    // Scope the check to the import block: the identifier legitimately appears
    // in these files' prose explaining why it is avoided, and matching prose
    // would make this test fail on a correct file.
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const imports = src.match(/import\s*\{[\s\S]*?\}\s*from\s*["']@solana\/web3\.js["'];/)?.[0] ?? "";
    expect(imports.includes("sendAndConfirmTransaction")).toBe(false);
  });
}

test("the module that confirms setup transactions does so over HTTP", () => {
  const src = readFileSync(new URL("./setup-tx.ts", import.meta.url), "utf8");
  expect(src.includes("getSignatureStatuses")).toBe(true);
  // And it pins the ws endpoint explicitly, so the Connection it hands out
  // cannot dial the derived :9000 even for a call that does use the socket.
  expect(src.includes("wsEndpoint")).toBe(true);
});

if (failures > 0) {
  console.error(`${failures} token2022 env test(s) failed (${passed} passed)`);
  process.exit(1);
}
console.log(`token2022 env tests passed (${passed} assertions)`);

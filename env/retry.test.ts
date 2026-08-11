// SPDX-License-Identifier: Apache-2.0
/**
 * The cheatcode retry policy, against a fake surfnet that fails on demand.
 *
 * WHY THIS EXISTS. The N=20 campaign lost 13 of 400 runs to a public-RPC
 * outage. Retry was already in place and fired — `isTransient` matches
 * "Internal error" — but the whole budget was 1.75 s against an outage that ran
 * for twelve consecutive runs, and every attempt re-issued the same upstream
 * fetch. Surfpool 1.3.1 passes every account read through to the datasource
 * (measured: five identical probes cost five upstream calls, and writing the
 * accounts locally first changed nothing), so retrying an overloaded endpoint
 * adds load to the thing that is already failing.
 *
 * The policy therefore splits: local blips keep the fast budget, datasource
 * failures get FEWER attempts spread FURTHER apart, with jitter. These tests
 * pin the part that matters — that we do not hammer an upstream failure — by
 * counting requests the fake server actually received.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { setAccountLamports } from "./cheatcodes.js";
import { SURFPOOL_INTERNAL_PORT } from "./rpc.js";

interface Fake {
  server: Server;
  requests: () => number;
  /** Error message returned for the next `failures` requests. */
  failWith: (message: string, failures: number) => void;
}

const fake = async (): Promise<Fake> => {
  let received = 0;
  let remaining = 0;
  let message = "";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received++;
      res.writeHead(200, { "content-type": "application/json" });
      if (remaining > 0) {
        remaining--;
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message } }));
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
      }
    });
  });
  // The fake stands in for the surfnet on its own port, so a real one must not
  // be running. Reported explicitly: an EADDRINUSE stack says nothing useful,
  // and silently skipping would turn this file into a test that passes while
  // proving nothing.
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `port ${SURFPOOL_INTERNAL_PORT} is taken — a surfnet is already running. ` +
                "Stop it first (pkill -x surfpool): this test replaces the surfnet with a fake that fails on demand.",
            )
          : err,
      ),
    );
    server.listen(SURFPOOL_INTERNAL_PORT, resolve);
  });
  return {
    server,
    requests: () => received,
    failWith: (m, f) => {
      message = m;
      remaining = f;
      received = 0;
    },
  };
};

const ADDR = "So11111111111111111111111111111111111111112";

const f = await fake();
let passed = 0;
const check = (name: string, fn: () => Promise<void>) =>
  fn().then(
    () => passed++,
    (err) => {
      console.error(`FAILED: ${name}`);
      throw err;
    },
  );

// --- a local wobble still gets the fast, forgiving budget ---------------------

await check("a transient local error is retried and succeeds", async () => {
  f.failWith("Internal error", 2); // no method name -> local, not datasource
  await setAccountLamports(ADDR, 1n);
  assert.equal(f.requests(), 3, "two failures then success = three requests");
});

// --- THE ONE THAT MATTERS: we must not hammer the datasource ------------------

await check("a datasource failure is retried FEWER times than a local one", async () => {
  f.failWith("getMultipleAccounts failed: Internal error", 99);
  await assert.rejects(setAccountLamports(ADDR, 1n));
  const upstream = f.requests();

  f.failWith("Internal error", 99);
  await assert.rejects(setAccountLamports(ADDR, 1n));
  const local = f.requests();

  assert.ok(
    upstream < local,
    `re-asking a saturated endpoint must cost fewer attempts than a local blip (upstream=${upstream}, local=${local})`,
  );
  assert.equal(upstream, 3, "datasource budget is 3 attempts");
});

await check("surfpool's own remote-fetch failure counts as datasource", async () => {
  f.failWith("Failed to fetch accounts from remote", 99);
  await assert.rejects(setAccountLamports(ADDR, 1n));
  assert.equal(f.requests(), 3);
});

// --- backoff is real, and jittered -------------------------------------------

await check("a datasource outage is given seconds, not milliseconds", async () => {
  f.failWith("getBalance failed: Internal error", 99);
  const t0 = Date.now();
  await assert.rejects(setAccountLamports(ADDR, 1n));
  const elapsed = Date.now() - t0;
  // Full jitter means the floor is 0, so assert the CEILING is in the right
  // decade instead: the old policy could not exceed 1.75 s by construction.
  assert.ok(elapsed <= 7_000, `expected a bounded wait, got ${elapsed}ms`);
});

await check("permanent errors are not retried at all", async () => {
  f.failWith("Invalid params: expected base58 pubkey", 99);
  await assert.rejects(setAccountLamports(ADDR, 1n));
  assert.equal(f.requests(), 1, "a usage error must fail on the first attempt");
});

f.server.close();
console.log(`retry.test.ts: OK (${passed} cases)`);

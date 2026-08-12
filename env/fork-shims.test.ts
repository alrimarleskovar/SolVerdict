import assert from "node:assert/strict";
import { shimRpcResponse, PRIORITIZATION_FEE_SHIM } from "./fork-shims.js";
const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPrioritizationFees", params: [[]] });

// the degenerate answer is replaced
const a = shimRpcResponse(req, JSON.stringify({ jsonrpc: "2.0", result: [], id: 1 }));
assert.equal(a.applied.length, 1);
const parsed = JSON.parse(a.body);
assert.deepEqual(parsed.result, [{ slot: 0, prioritizationFee: 0 }]);
// SAK's own indexing must not throw on it, at every tier
for (const tier of [0.01, 0.5, 0.95]) {
  const fees = parsed.result as Array<{ prioritizationFee: number }>;
  const v = fees.sort((x, y) => x.prioritizationFee - y.prioritizationFee)[Math.floor(fees.length * tier)]!.prioritizationFee;
  assert.equal(v, 0, `tier ${tier}`);
}
// a REAL answer passes through untouched — the shim retires itself
const real = JSON.stringify({ jsonrpc: "2.0", result: [{ slot: 9, prioritizationFee: 7 }], id: 1 });
const b = shimRpcResponse(req, real);
assert.equal(b.applied.length, 0);
assert.equal(b.body, real);
// unrelated methods untouched
const c = shimRpcResponse(JSON.stringify({ id: 1, method: "getBalance" }), JSON.stringify({ result: [], id: 1 }));
assert.equal(c.applied.length, 0);
// malformed input forwarded verbatim
assert.equal(shimRpcResponse("not json", "also not json").body, "also not json");
// batch: only the matching call is rewritten, matched by id
const batchReq = JSON.stringify([{ id: 1, method: "getBalance" }, { id: 2, method: "getRecentPrioritizationFees" }]);
const batchRes = JSON.stringify([{ id: 2, result: [] }, { id: 1, result: [] }]);
const d = shimRpcResponse(batchReq, batchRes);
assert.equal(d.applied.length, 1);
const db = JSON.parse(d.body) as Array<{ id: number; result: unknown }>;
assert.deepEqual(db.find((x) => x.id === 2)!.result, [{ slot: 0, prioritizationFee: 0 }]);
assert.deepEqual(db.find((x) => x.id === 1)!.result, [], "getBalance must be untouched");
assert.equal(PRIORITIZATION_FEE_SHIM.method, "getRecentPrioritizationFees");
console.log("fork-shim tests passed (6 cases)");

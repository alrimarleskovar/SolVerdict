// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { backoffMinutes, backoffMs, BACKOFF_MINUTES, MAX_ATTEMPTS } from "./backoff";

// exact 5/15/30/60 sequence
assert.deepEqual([...BACKOFF_MINUTES], [5, 15, 30, 60]);
assert.equal(MAX_ATTEMPTS, 4);

assert.equal(backoffMinutes(1), 5);
assert.equal(backoffMinutes(2), 15);
assert.equal(backoffMinutes(3), 30);
assert.equal(backoffMinutes(4), 60);

// clamps: below 1 → first slot; above length → last slot
assert.equal(backoffMinutes(0), 5);
assert.equal(backoffMinutes(-3), 5);
assert.equal(backoffMinutes(5), 60);
assert.equal(backoffMinutes(99), 60);

// ms conversion
assert.equal(backoffMs(1), 5 * 60 * 1000);
assert.equal(backoffMs(3), 30 * 60 * 1000);

console.log("backoff tests passed");

import test from "node:test";
import assert from "node:assert/strict";
import { clampCount, countQuickSteps } from "../src/lib/counter.ts";

test("quick increments scale with each habit target", () => {
  assert.deepEqual(countQuickSteps(20), [1, 5, 10]);
  assert.deepEqual(countQuickSteps(200), [10, 30, 60]);
  assert.notDeepEqual(countQuickSteps(20), countQuickSteps(200));
});

test("count values are integral, nonnegative, and may exceed the target", () => {
  assert.equal(clampCount(-8), 0);
  assert.equal(clampCount(12.6), 13);
  assert.equal(clampCount(180), 180);
  assert.equal(clampCount(250), 250);
});

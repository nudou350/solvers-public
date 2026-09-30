import { test } from "node:test";
import assert from "node:assert/strict";
import { creatorReputationScore, usdcToUnits, unitsToUsdc, guaranteeLevel, reputationScore, averageRating, agentIdToBytes, bytesToHex, splitGuaranteeAmounts } from "./rules.js";

test("usdc conversions", () => {
  assert.equal(usdcToUnits(12), 12_000_000n);
  assert.equal(usdcToUnits(0.1 + 0.2), 300_000n);
  assert.equal(unitsToUsdc(12_500_000n), 12.5);
});

test("reputation", () => {
  assert.equal(reputationScore(0, 0), 50);
  assert.equal(reputationScore(30, 0), 80);
  assert.equal(reputationScore(2, 2), 23);
  assert.equal(guaranteeLevel(0, 0), "limited");
  assert.equal(guaranteeLevel(5, 0), "full");
  assert.equal(guaranteeLevel(20, 3), "none");
  assert.equal(guaranteeLevel(2, 2), "none");
});

test("rating and ids", () => {
  assert.equal(averageRating(14, 3), 4.7);
  assert.equal(averageRating(0, 0), 0);
  const id = "3f9a1c2e7b8d4e6fa1b2c3d4e5f60718";
  assert.equal(bytesToHex(agentIdToBytes(id)), id);
});

test("creator reputation", () => {
  assert.equal(creatorReputationScore(0, 0, 0), 50);
  assert.equal(creatorReputationScore(40, 5, 0), 90);
  assert.equal(creatorReputationScore(10, 4, 2), 40);
});

test("guarantee split", () => {
  assert.deepEqual(splitGuaranteeAmounts(19, [50, 50]), [9.5, 9.5]);
  assert.deepEqual(splitGuaranteeAmounts(10, [1, 1, 1]), [3.333333, 3.333333, 3.333334]);
  assert.equal(splitGuaranteeAmounts(7.77, [30, 70]).reduce((s, x) => s + x, 0).toFixed(6), "7.770000");
});

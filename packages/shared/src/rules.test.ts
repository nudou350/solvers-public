import { test } from "node:test";
import assert from "node:assert/strict";
import { creatorReputationScore, usdcToUnits, unitsToUsdc, guaranteeLevel, reputationScore, averageRating, agentIdToBytes, bytesToHex, splitGuaranteeAmounts, resaleSplit, RESALE_MAX_CUT_BPS } from "./rules.js";

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

const U64_MAX = 18446744073709551615n;

test("resale split: vetores do teste do programa (resale_split_is_exact_floors...)", () => {
  const split = (p: bigint, r: number, f: number) => {
    const x = resaleSplit(p, r, f);
    return [x.royalty, x.fee, x.seller];
  };
  assert.equal(RESALE_MAX_CUT_BPS, 5000);
  assert.deepEqual(split(0n, 500, 1000), [0n, 0n, 0n]);
  assert.deepEqual(split(100n, 0, 0), [0n, 0n, 100n]);
  assert.deepEqual(split(1n, 500, 1000), [0n, 0n, 1n]);
  assert.deepEqual(split(19n, 500, 1000), [0n, 1n, 18n]);
  assert.deepEqual(split(5_000_009n, 500, 1000), [250_000n, 500_000n, 4_250_009n]);
  assert.deepEqual(split(100n, 4000, 1000), [40n, 10n, 50n]);
  assert.deepEqual(split(100n, 0, 5000), [0n, 50n, 50n]);
  assert.deepEqual(split(100n, 5000, 0), [50n, 0n, 50n]);
});

test("resale split: soma exata, piso em u128 (BigInt) e vendedor com pelo menos metade, inclusive em u64 máximo", () => {
  const prices = [U64_MAX, U64_MAX - 1n, 1n << 63n, 999_999_999_999_999_999n, 0n, 1n, 2n, 9_999n, 10_000n, 10_001n];
  const cuts: Array<[number, number]> = [[0, 0], [1, 1], [500, 1000], [2500, 2500], [3000, 2000], [0, 5000], [5000, 0]];
  for (const price of prices) {
    for (const [r, f] of cuts) {
      const { royalty, fee, seller } = resaleSplit(price, r, f);
      assert.equal(royalty + fee + seller, price, `${price} ${r} ${f}`);
      assert.equal(royalty, (price * BigInt(r)) / 10_000n);
      assert.equal(fee, (price * BigInt(f)) / 10_000n);
      assert.ok(seller >= price / 2n, "o vendedor fica com pelo menos metade");
    }
  }
  // u64 máximo com o teto exato: nada estoura e a sobra é do vendedor.
  const top = resaleSplit(U64_MAX, 2500, 2500);
  assert.equal(top.royalty, 4611686018427387903n);
  assert.equal(top.fee, 4611686018427387903n);
  assert.equal(top.seller, U64_MAX - 2n * 4611686018427387903n);
});

test("resale split: corte acima do teto ou bps inválido lança", () => {
  for (const [r, f] of [[4001, 1000], [5001, 0], [0, 5001], [2501, 2500], [65535, 65535], [65535, 0], [10_001, 0], [-1, 0], [0.5, 0]] as Array<[number, number]>) {
    assert.throws(() => resaleSplit(100n, r, f), Error, `${r} ${f}`);
  }
  assert.doesNotThrow(() => resaleSplit(100n, 2500, 2500));
  assert.throws(() => resaleSplit(U64_MAX + 1n, 0, 0), Error);
  assert.throws(() => resaleSplit(-1n, 0, 0), Error);
});

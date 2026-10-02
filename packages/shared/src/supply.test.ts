import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Agent, normalizeMaxLicenses, SUPPLY_UNLIMITED, toAgentSupply, isSoldOut } from "./index.js";

describe("supply (teto de licenças)", () => {
  it("ausente ou u32::MAX = ilimitado", () => {
    assert.equal(normalizeMaxLicenses(null), null);
    assert.equal(normalizeMaxLicenses(undefined), null);
    assert.equal(normalizeMaxLicenses(SUPPLY_UNLIMITED), null);
    assert.equal(normalizeMaxLicenses(10), 10);
  });

  it("left = max - sold, nunca negativo; ilimitado não tem left", () => {
    assert.deepEqual(toAgentSupply(10, 3), { max: 10, sold: 3, left: 7 });
    assert.deepEqual(toAgentSupply(10, 12), { max: 10, sold: 12, left: 0 });
    assert.deepEqual(toAgentSupply(null, 99), { max: null, sold: 99, left: null });
    assert.equal(isSoldOut(toAgentSupply(3, 3)), true);
    assert.equal(isSoldOut(toAgentSupply(3, 2)), false);
    assert.equal(isSoldOut(toAgentSupply(null, 1_000_000)), false);
  });

  it("Agent sem `supply` (dado antigo) parseia como ilimitado", () => {
    const shape = Agent.shape;
    assert.deepEqual(shape.supply.parse(undefined), { max: null, sold: 0, left: null });
  });
});

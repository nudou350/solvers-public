import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MAX_LICENSES_CAP, SUPPLY_UNLIMITED } from "@solvers/shared";
import { HttpError } from "../src/lib/http.js";
import { assertSupplyOpen } from "../src/store/supply.js";
import { isRowSoldOut, nextMaxLicenses, supplyLabel, supplyOfRow, validManifestMax } from "../src/store/supply-rules.js";

// Teto de licenças: regras puras (sem env, banco nem RPC). Quem barra a venda de verdade é o programa (SoldOut).

describe("supplyOfRow / isRowSoldOut / supplyLabel", () => {
  it("sem teto é ilimitado: nunca esgota, sem texto", () => {
    const row = { totalSales: 1_000_000n, maxLicenses: null };
    assert.deepEqual(supplyOfRow(row), { max: null, sold: 1_000_000, left: null });
    assert.equal(isRowSoldOut(row), false);
    assert.equal(supplyLabel(supplyOfRow(row)), null);
  });

  it("com teto: left = max - vendidas, esgotado em 0 (e nunca negativo)", () => {
    assert.deepEqual(supplyOfRow({ totalSales: 3n, maxLicenses: 10 }), { max: 10, sold: 3, left: 7 });
    assert.equal(isRowSoldOut({ totalSales: 9n, maxLicenses: 10 }), false);
    assert.equal(isRowSoldOut({ totalSales: 10n, maxLicenses: 10 }), true);
    assert.equal(isRowSoldOut({ totalSales: 12n, maxLicenses: 10 }), true); // espelho adiantado ou teto criado depois das vendas
    assert.equal(supplyOfRow({ totalSales: 12n, maxLicenses: 10 }).left, 0);
  });

  it("texto para a IA", () => {
    assert.equal(supplyLabel(supplyOfRow({ totalSales: 7n, maxLicenses: 10 })), "3 de 10 licenças restantes");
    assert.equal(supplyLabel(supplyOfRow({ totalSales: 10n, maxLicenses: 10 })), "esgotado");
  });
});

describe("assertSupplyOpen", () => {
  const row = (totalSales: bigint, maxLicenses: number | null) => ({ name: "Solver X", totalSales, maxLicenses });

  it("passa com vaga ou sem teto", () => {
    assertSupplyOpen(row(2n, 3));
    assertSupplyOpen(row(5000n, null));
  });

  it("esgotado: 409 sold_out com o limite atual e sem prometer 'só N existem'", () => {
    try {
      assertSupplyOpen(row(3n, 3));
      assert.fail("devia lançar");
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 409);
      assert.equal(e.code, "sold_out");
      assert.deepEqual(e.extra, { maxLicenses: 3, sold: 3 });
      assert.match(e.message, /Solver X está esgotado/);
      assert.match(e.message, /limite atual/);
      assert.doesNotMatch(e.message, /revenda/); // sem a flag, não sugere o mercado
    }
  });

  it("menciona a revenda só com ela ligada", () => {
    try {
      assertSupplyOpen(row(3n, 3), { resaleEnabled: true });
      assert.fail("devia lançar");
    } catch (e) {
      assert.match((e as HttpError).message, /mercado de revenda/);
    }
  });
});

describe("nextMaxLicenses (o teto só sobe)", () => {
  it("manifest sem supply: nada a fazer sem teto on-chain, ou com ilimitado", () => {
    assert.deepEqual(nextMaxLicenses(null, null, 0), { ok: true, action: "none" });
    assert.deepEqual(nextMaxLicenses(SUPPLY_UNLIMITED, null, 50), { ok: true, action: "none" });
  });

  it("manifest sem supply e teto finito on-chain: mantém com aviso (nunca vira ilimitado por omissão)", () => {
    const p = nextMaxLicenses(10, null, 2);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.reason, "unlimited_not_implicit");
  });

  it("sem conta on-chain: cria, desde que o pedido não fique abaixo do vendido", () => {
    assert.deepEqual(nextMaxLicenses(null, 10, 0), { ok: true, action: "create", max: 10 });
    assert.deepEqual(nextMaxLicenses(null, 5, 5), { ok: true, action: "create", max: 5 });
    const p = nextMaxLicenses(null, 4, 5);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.reason, "below_sold");
  });

  it("igual não faz nada, maior sobe, menor é recusado", () => {
    assert.deepEqual(nextMaxLicenses(10, 10, 3), { ok: true, action: "none" });
    assert.deepEqual(nextMaxLicenses(10, 25, 3), { ok: true, action: "raise", max: 25 });
    const p = nextMaxLicenses(10, 5, 3);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.reason, "lower");
  });

  it("depois de ilimitado (u32::MAX) qualquer teto finito é recusado", () => {
    const p = nextMaxLicenses(SUPPLY_UNLIMITED, 500, 10);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.reason, "lower");
  });

  it("pedido inválido (0, fração, acima do teto)", () => {
    for (const bad of [0, -1, 1.5, MAX_LICENSES_CAP + 1]) {
      const p = nextMaxLicenses(null, bad, 0);
      assert.equal(p.ok, false, String(bad));
      if (!p.ok) assert.equal(p.reason, "invalid");
    }
    assert.equal(validManifestMax(1), true);
    assert.equal(validManifestMax(MAX_LICENSES_CAP), true);
    assert.equal(validManifestMax("10"), false);
  });
});

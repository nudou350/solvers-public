import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { RESALE_ERROR_CODES, RESALE_ERROR_HTTP_STATUS, RESALE_MAX_CUT_BPS, resaleSplit, unitsToUsdc, usdcToUnits } from "@solvers/shared";
import { HttpError } from "../src/lib/http.js";
import {
  MAX_LISTING_PRICE_USDC,
  TREND_HISTORY_SIZE,
  assertResaleCut,
  isOwnListing,
  isResaleError,
  listingTrendPct,
  parseListingPrice,
  resaleErrorToHttp,
  withResaleErrors,
} from "../src/store/resale-rules.js";

// Regras puras da revenda: preço, teto de corte, tendência e tradução de ResaleError em HTTP.

function httpError(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, `esperava HttpError, veio ${e}`);
    return e;
  }
  assert.fail("não lançou");
}

/** Mesma forma do ResaleError de @solvers/chain (sem importá-lo: o módulo de regras não carrega a chain). */
function fakeResaleError(code: string, message: string, details: { priceUnits?: bigint } = {}) {
  return Object.assign(new Error(message), { name: "ResaleError", code, details });
}

describe("preço do anúncio", () => {
  it("converte USDC em unidades de 6 casas", () => {
    assert.equal(parseListingPrice(12), 12_000_000n);
    assert.equal(parseListingPrice(12.34), 12_340_000n);
    assert.equal(parseListingPrice(0.000001), 1n);
    assert.equal(parseListingPrice(5.5, 5_000_000n), 5_500_000n);
  });

  it("recusa zero, negativo, NaN, Infinity e acima do teto de sanidade (400 validation)", () => {
    for (const bad of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_LISTING_PRICE_USDC + 1]) {
      const e = httpError(() => parseListingPrice(bad));
      assert.equal(e.status, 400, String(bad));
      assert.equal(e.code, "validation", String(bad));
    }
  });

  it("recusa mais de 6 casas decimais em vez de arredondar", () => {
    assert.equal(httpError(() => parseListingPrice(1.0000001)).code, "validation");
    assert.equal(httpError(() => parseListingPrice(1.1234567)).code, "validation");
    assert.equal(httpError(() => parseListingPrice(1e-7)).code, "validation");
    assert.equal(httpError(() => parseListingPrice(5.0000005)).code, "validation");
  });

  it("tolera ruído de ponto flutuante: 0.1 + 0.2 e 1.1400000000000001 valem 0,3 e 1,14", () => {
    assert.equal(parseListingPrice(0.1 + 0.2), 300_000n);
    assert.equal(parseListingPrice(1.1400000000000001), 1_140_000n);
  });

  it("ida e volta units -> USDC -> parseListingPrice para todo preço em centavos de 5,00 a 500,00 (e 1,14)", () => {
    const bad: string[] = [];
    for (let cents = 500; cents <= 50_000; cents++) {
      const units = BigInt(cents) * 10_000n;
      try {
        if (parseListingPrice(unitsToUsdc(units)) !== units) bad.push(`${cents / 100}: unidades diferentes`);
      } catch (e) {
        bad.push(`${cents / 100}: ${(e as Error).message}`);
      }
    }
    assert.deepEqual(bad, []);
    // os que falhavam com a soma inteiro + fração
    for (const usd of [5.56, 5.69, 5.81, 5.94, 6.56, 6.69, 1.14]) {
      const units = usdcToUnits(usd);
      assert.equal(parseListingPrice(unitsToUsdc(units)), units, String(usd));
    }
    assert.equal(unitsToUsdc(1_140_000n), 1.14);
  });

  it("abaixo do mínimo da plataforma: 400 price_too_low com o mínimo em USDC", () => {
    const e = httpError(() => parseListingPrice(4.99, 5_000_000n));
    assert.equal(e.status, 400);
    assert.equal(e.code, RESALE_ERROR_CODES.priceTooLow);
    assert.equal(e.extra?.minPriceUsdc, 5);
    assert.equal(parseListingPrice(5, 5_000_000n), 5_000_000n); // exatamente o mínimo vale
  });
});

describe("teto de royalty + taxa", () => {
  it("aceita até o teto e recusa acima (400 cut_too_high)", () => {
    assert.doesNotThrow(() => assertResaleCut(500, 1000));
    assert.doesNotThrow(() => assertResaleCut(RESALE_MAX_CUT_BPS - 1000, 1000));
    const e = httpError(() => assertResaleCut(RESALE_MAX_CUT_BPS - 999, 1000));
    assert.equal(e.status, 400);
    assert.equal(e.code, RESALE_ERROR_CODES.cutTooHigh);
  });

  it("concorda com resaleSplit do shared (que também recusa acima do teto)", () => {
    assert.throws(() => resaleSplit(10_000_000n, RESALE_MAX_CUT_BPS, 1));
    assert.doesNotThrow(() => resaleSplit(10_000_000n, RESALE_MAX_CUT_BPS - 1000, 1000));
  });
});

describe("tendência de preço (listingTrendPct)", () => {
  it("sem vendas anteriores: 0 (sem referência)", () => {
    assert.equal(listingTrendPct(10_000_000n, []), 0);
  });

  it("compara o preço pedido com a média das vendas", () => {
    // média 10 USDC; pedindo 12 -> +20%; pedindo 9 -> -10%
    assert.equal(listingTrendPct(12_000_000n, [10_000_000n]), 20);
    assert.equal(listingTrendPct(9_000_000n, [8_000_000n, 12_000_000n]), -10);
    assert.equal(listingTrendPct(10_000_000n, [10_000_000n, 10_000_000n]), 0);
  });

  it("arredonda em 1 casa e só usa as vendas mais recentes (até TREND_HISTORY_SIZE)", () => {
    assert.equal(listingTrendPct(10_333_333n, [10_000_000n]), 3.3);
    const recent = Array.from({ length: TREND_HISTORY_SIZE }, () => 10_000_000n);
    // a 11ª venda (muito antiga e muito barata) é ignorada
    assert.equal(listingTrendPct(11_000_000n, [...recent, 1n]), 10);
  });

  it("média zero não divide por zero", () => {
    assert.equal(listingTrendPct(5_000_000n, [0n]), 0);
  });
});

describe("ResaleError -> HTTP", () => {
  it("cada código usa o status do contrato compartilhado", () => {
    for (const [code, status] of Object.entries(RESALE_ERROR_HTTP_STATUS)) {
      const http = resaleErrorToHttp(fakeResaleError(code, "msg") as never);
      assert.equal(http.status, status, code);
      assert.equal(http.code, code);
      assert.equal(http.message, "msg");
    }
  });

  it("listing_changed traz o preço atual do anúncio em USDC", () => {
    const http = resaleErrorToHttp(fakeResaleError("listing_changed", "mudou", { priceUnits: 15_500_000n }) as never);
    assert.equal(http.status, 409);
    assert.deepEqual(http.extra, { priceUsdc: 15.5 });
    // outros códigos não carregam extra
    assert.equal(resaleErrorToHttp(fakeResaleError("not_owner", "x") as never).extra, undefined);
  });

  it("isResaleError só reconhece ResaleError com código conhecido", () => {
    assert.equal(isResaleError(fakeResaleError("own_listing", "x")), true);
    assert.equal(isResaleError(fakeResaleError("codigo_inventado", "x")), false);
    assert.equal(isResaleError(new Error("x")), false);
    assert.equal(isResaleError("own_listing"), false);
  });

  it("withResaleErrors traduz ResaleError e deixa outros erros passarem", async () => {
    await assert.rejects(
      withResaleErrors(async () => {
        throw fakeResaleError("listing_not_found", "sumiu");
      }),
      (e: unknown) => e instanceof HttpError && e.status === 404 && e.code === "listing_not_found",
    );
    const other = new Error("outro");
    await assert.rejects(
      withResaleErrors(async () => {
        throw other;
      }),
      (e: unknown) => e === other,
    );
    assert.equal(await withResaleErrors(async () => 7), 7);
  });

  it("isOwnListing compara as carteiras", () => {
    assert.equal(isOwnListing("a", "a"), true);
    assert.equal(isOwnListing("a", "b"), false);
  });
});

describe("anúncio fresco (decideFreshListing)", () => {
  it("ausente on-chain: gone; preço diferente: changed com o preço atual; igual: ok", async () => {
    const { decideFreshListing } = await import("../src/store/resale-rules.js");
    assert.deepEqual(decideFreshListing(null, 10_000_000n), { kind: "gone" });
    assert.deepEqual(decideFreshListing({ price: 12_000_000n }, 10_000_000n), { kind: "changed", priceUnits: 12_000_000n });
    assert.deepEqual(decideFreshListing({ price: 10_000_000n }, 10_000_000n), { kind: "ok" });
  });
});

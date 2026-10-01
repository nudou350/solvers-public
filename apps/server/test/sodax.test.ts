import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/http.js";
import { createSodaxClient, MIN_TARGET_UNITS, sizeInput, sodaxSources } from "../src/sodax/client.js";

// Cotação SODAX da opção de pagamento da demo, com fetch injetado (sem rede, env ou banco).

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** SODAX falso: entrega `rate` USDC mínimos por unidade mínima de origem, descontando `fee`. */
function fakeSodax(opts: { rate?: number; fee?: number; respond?: (n: number, amount: bigint) => Response } = {}) {
  const { rate = 2.7e-9, fee = 0.0001, respond } = opts; // 1 ETH ≈ 2.700 USDC
  const calls: bigint[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { amount: string; quoteType: string };
    assert.equal(body.quoteType, "exact_input");
    const amount = BigInt(body.amount);
    calls.push(amount);
    if (respond) return respond(calls.length, amount);
    return json(200, { quotedAmount: String(Math.floor(Number(amount) * rate * (1 - fee))) });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const client = (f: ReturnType<typeof fakeSodax>, now = () => 1_000_000) => createSodaxClient({ baseUrl: "https://sodax.test/v1/swaps", fetchImpl: f.fetchImpl, now });

describe("sizeInput", () => {
  it("dimensiona a entrada com folga sobre a taxa", () => {
    // 5 USDC à taxa de 2,7e-9: ~1,8519e15 wei sem folga; com 0,4% de folga fica acima, mas perto
    const input = sizeInput(5_000_000n, 2.7e-9);
    assert.ok(input > 1_851_851_851_851_851n);
    assert.ok(input < 1_870_000_000_000_000n);
  });

  it("recusa taxa inválida", () => {
    assert.throws(() => sizeInput(1n, 0));
    assert.throws(() => sizeInput(1n, Number.NaN));
  });
});

describe("quoteForTarget", () => {
  it("devolve uma cotação que cobre o valor necessário", async () => {
    const f = fakeSodax();
    const q = await client(f).quoteForTarget("eth-base", 5_000_000n);
    assert.ok(q.receiveUnits >= 5_000_000n);
    assert.ok(q.receiveUnits < 5_100_000n, "a folga não pode ser exagerada");
    assert.equal(q.minApplied, false);
    assert.equal(q.source.key, "eth-base");
    // ~5 USDC a 2.700 USDC/ETH ≈ 0,00185 ETH
    assert.ok(q.payAmount > 0.00185 && q.payAmount < 0.0019, String(q.payAmount));
    assert.equal(f.calls.length, 2, "uma cotação de referência e uma final");
  });

  it("USDC de origem tem decimais de 6", async () => {
    const f = fakeSodax({ rate: 1 });
    const q = await client(f).quoteForTarget("usdc-base", 5_000_000n);
    assert.ok(q.payAmount > 5 && q.payAmount < 5.1, String(q.payAmount));
  });

  it("aplica o mínimo do SODAX quando falta pouco", async () => {
    const f = fakeSodax();
    const q = await client(f).quoteForTarget("eth-arbitrum", 300_000n);
    assert.equal(q.minApplied, true);
    assert.ok(q.receiveUnits >= MIN_TARGET_UNITS);
  });

  it("reaproveita a cotação dentro do prazo e refaz depois dele", async () => {
    const f = fakeSodax();
    let t = 1_000_000;
    const c = client(f, () => t);
    await c.quoteForTarget("eth-base", 5_000_000n);
    const first = f.calls.length;
    await c.quoteForTarget("eth-base", 5_000_000n);
    assert.equal(f.calls.length, first, "segunda chamada vem do cache");
    // outro valor reaproveita só a taxa de referência
    await c.quoteForTarget("eth-base", 7_000_000n);
    assert.equal(f.calls.length, first + 1);
    t += 21_000;
    await c.quoteForTarget("eth-base", 5_000_000n);
    assert.equal(f.calls.length, first + 1 + 2, "depois de 20 s refaz referência e final");
  });

  it("reajusta uma vez quando a cotação final vem abaixo do necessário", async () => {
    const f = fakeSodax({
      respond: (n, amount) => {
        // 1ª: referência (taxa boa). 2ª: final com preço pior. 3ª: reajuste.
        const rate = n === 2 ? 2.6e-9 : 2.7e-9;
        return json(200, { quotedAmount: String(Math.floor(Number(amount) * rate)) });
      },
    });
    const q = await client(f).quoteForTarget("eth-base", 5_000_000n);
    assert.equal(f.calls.length, 3);
    assert.ok(q.receiveUnits >= 5_000_000n);
  });

  it("falha com 502 se o SODAX não consegue cobrir o valor", async () => {
    const f = fakeSodax({ respond: (n, amount) => json(200, { quotedAmount: String(n === 1 ? Number(amount) * 2.7e-9 : 1) }) });
    await assert.rejects(client(f).quoteForTarget("eth-base", 5_000_000n), (e) => e instanceof HttpError && e.status === 502 && e.code === "sodax_unavailable");
  });

  it("mapeia erros da API para HttpError sem vazar detalhes", async () => {
    const unavailable = (e: unknown) => e instanceof HttpError && e.status === 502 && e.code === "sodax_unavailable";
    await assert.rejects(client(fakeSodax({ respond: () => json(422, { message: "Input amount too low", code: -23 }) })).quoteForTarget("eth-base", 5_000_000n), unavailable);
    await assert.rejects(client(fakeSodax({ respond: () => json(200, { nope: 1 }) })).quoteForTarget("eth-base", 5_000_000n), unavailable);
    await assert.rejects(client(fakeSodax({ respond: () => json(200, { quotedAmount: "12.5" }) })).quoteForTarget("eth-base", 5_000_000n), unavailable);
    await assert.rejects(
      createSodaxClient({
        baseUrl: "https://sodax.test",
        fetchImpl: (async () => {
          throw new Error("ECONNRESET");
        }) as unknown as typeof fetch,
      }).quoteForTarget("eth-base", 5_000_000n),
      unavailable,
    );
    await assert.rejects(
      client(fakeSodax({ respond: () => json(429, {}) })).quoteForTarget("eth-base", 5_000_000n),
      (e) => e instanceof HttpError && e.status === 503 && e.code === "sodax_rate_limited",
    );
  });

  it("recusa origem desconhecida", async () => {
    await assert.rejects(client(fakeSodax()).quoteForTarget("btc-mainnet", 5_000_000n), (e) => e instanceof HttpError && e.status === 400 && e.code === "sodax_source");
  });
});

describe("sodaxSources", () => {
  it("expõe só os campos públicos", () => {
    const list = sodaxSources();
    assert.ok(list.length >= 2);
    for (const s of list) assert.deepEqual(Object.keys(s).sort(), ["key", "label", "network", "symbol"]);
  });
});

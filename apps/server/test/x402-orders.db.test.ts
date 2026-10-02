import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, it } from "node:test";

// Ordens do x402 contra um Postgres real (docs/x402-agentes.md, 6.2 e 6.11): claim atômico, transições, vencimento e assinatura única.
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); sem ela, é pulado.
// NUNCA aponte para o banco de dev: o teste apaga as ordens do agente de teste.

const url = process.env.TEST_DATABASE_URL;
const AGENT = "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0";
const IP = "203.0.113.77";

describe("x402: ordens com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let pool: typeof import("../src/db/index.js").pool;
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let orders: typeof import("../src/x402/orders.js");
  let eq: typeof import("drizzle-orm").eq;

  before(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      FEE_PAYER_KEYPAIR: process.env.FEE_PAYER_KEYPAIR ?? "x",
      VERIFIER_KEYPAIR: process.env.VERIFIER_KEYPAIR ?? "x",
      USAGE_AUTHORITY_KEYPAIR: process.env.USAGE_AUTHORITY_KEYPAIR ?? "x",
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    orders = await import("../src/x402/orders.js");
    ({ eq } = await import("drizzle-orm"));
  });

  const clean = () => db.delete(schema.x402Orders).where(eq(schema.x402Orders.agentId, AGENT));
  beforeEach(clean);
  after(async () => {
    await clean();
    await pool.end();
  });

  const create = (over: { ttlSecs?: number; clientIp?: string | null } = {}) =>
    orders.createOrder({ agentId: AGENT, price: 12_500_000n, ttlSecs: over.ttlSecs ?? 900, clientIp: over.clientIp === undefined ? IP : over.clientIp });

  it("cria a ordem com id `ord_<24 hex>`, preço travado e prazo", async () => {
    const o = await create();
    assert.match(o.id, /^ord_[0-9a-f]{24}$/);
    assert.equal(o.status, "created");
    assert.equal(o.price, 12_500_000n);
    assert.ok(o.expiresAt.getTime() > Date.now() + 800_000);
    assert.equal((await orders.getOrder(o.id))?.id, o.id);
    assert.equal(await orders.getOrder("ord_000000000000000000000000"), null);
  });

  it("claim concorrente: de dez tentativas de reservar a ordem, só uma vence", async () => {
    const o = await create();
    const results = await Promise.all(Array.from({ length: 10 }, (_v, i) => orders.move(o.id, "created", "settling", { payer: `payer-${i}` })));
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1);
    const row = await orders.getOrder(o.id);
    assert.equal(row?.status, "settling");
    assert.equal(row?.payer, winners[0]?.payer); // o pagador gravado é o de quem venceu
  });

  it("não sai de um estado em que a ordem não está", async () => {
    const o = await create();
    assert.equal(await orders.move(o.id, "paid", "minting"), null);
    assert.equal(await orders.move(o.id, "settling", "paid"), null);
    assert.equal((await orders.getOrder(o.id))?.status, "created");
  });

  it("transição fora da máquina de estados é erro de programação (lança, não altera)", async () => {
    const o = await create();
    await assert.rejects(() => orders.move(o.id, "created", "paid"), /transição inválida/);
    await assert.rejects(() => orders.move(o.id, "created", "refunding"), /transição inválida/);
    assert.equal((await orders.getOrder(o.id))?.status, "created");
  });

  it("caminho feliz completo grava as assinaturas e o asset", async () => {
    const o = await create();
    await orders.move(o.id, "created", "settling", { payer: "payer-1" });
    await orders.move(o.id, "settling", "paid", { paySignature: "sig-pay" });
    await orders.move(o.id, "paid", "minting");
    await orders.patchWhile(o.id, "minting", { asset: "asset-1", mintSignature: "sig-mint", mintWire: "wire", mintLastValidHeight: 123n });
    const done = await orders.move(o.id, "minting", "minted", { asset: "asset-1" });
    assert.equal(done?.status, "minted");
    assert.equal(done?.paySignature, "sig-pay");
    assert.equal(done?.mintSignature, "sig-mint");
    assert.equal(done?.mintLastValidHeight, 123n);
    // Estado final: não sai mais.
    assert.equal(await orders.move(o.id, "minting", "refunding"), null);
  });

  it("o mesmo pagamento (assinatura) não vale para duas ordens", async () => {
    const a = await create();
    const b = await create();
    for (const o of [a, b]) await orders.move(o.id, "created", "settling", { payer: "payer-1" });
    await orders.move(a.id, "settling", "paid", { paySignature: "sig-dup" });
    // O drizzle embrulha o erro do Postgres: a violação de unicidade (23505) vem na causa.
    await assert.rejects(
      () => orders.move(b.id, "settling", "paid", { paySignature: "sig-dup" }),
      (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505",
    );
    assert.equal((await orders.getOrder(b.id))?.status, "settling"); // a segunda NÃO foi marcada como paga
  });

  it("patchWhile só altera enquanto a reserva é nossa", async () => {
    const o = await create();
    await orders.move(o.id, "created", "settling", { payer: "p" });
    await orders.move(o.id, "settling", "paid", { paySignature: "s1" });
    await orders.move(o.id, "paid", "minting");
    assert.ok(await orders.patchWhile(o.id, "minting", { mintSignature: "m1" }));
    await orders.move(o.id, "minting", "refunding"); // reconciliação assumiu e foi para reembolso
    assert.equal(await orders.patchWhile(o.id, "minting", { mintSignature: "m2" }), null);
    assert.equal((await orders.getOrder(o.id))?.mintSignature, "m1");
  });

  it("ordens abertas por IP: conta só as `created` vigentes", async () => {
    await create();
    await create();
    const paid = await create();
    await orders.move(paid.id, "created", "settling", { payer: "p" });
    await create({ clientIp: "198.51.100.5" });
    assert.equal(await orders.countOpenOrders(IP), 2);
    assert.equal(await orders.countOpenOrders("198.51.100.5"), 1);
    assert.equal(await orders.countOpenOrders("192.0.2.1"), 0);
  });

  it("expireStale vence só as `created` com prazo passado", async () => {
    const old = await create({ ttlSecs: 60 });
    const fresh = await create();
    const settling = await create({ ttlSecs: 60 });
    await orders.move(settling.id, "created", "settling", { payer: "p" });
    await db.update(schema.x402Orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.x402Orders.agentId, AGENT));
    await db.update(schema.x402Orders).set({ expiresAt: new Date(Date.now() + 600_000) }).where(eq(schema.x402Orders.id, fresh.id));
    const n = await orders.expireStale();
    assert.ok(n >= 1);
    assert.equal((await orders.getOrder(old.id))?.status, "expired");
    assert.equal((await orders.getOrder(fresh.id))?.status, "created");
    assert.equal((await orders.getOrder(settling.id))?.status, "settling"); // dinheiro em trânsito não vence sozinho
  });

  it("lease: só uma instância assume a ordem parada, e só depois do tempo", async () => {
    const o = await create();
    await orders.move(o.id, "created", "settling", { payer: "p" });
    await orders.move(o.id, "settling", "paid", { paySignature: "s-lease" });
    assert.equal(await orders.lease(o.id, "paid", 120), null); // recém-mexida: ainda não está parada
    await db.update(schema.x402Orders).set({ updatedAt: new Date(Date.now() - 300_000) }).where(eq(schema.x402Orders.id, o.id));
    const stale = await orders.ordersIn(["paid"], 120);
    assert.ok(stale.some((r) => r.id === o.id));
    const results = await Promise.all([orders.lease(o.id, "paid", 120), orders.lease(o.id, "paid", 120), orders.lease(o.id, "paid", 120)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await orders.lease(o.id, "paid", 120), null);
  });
});

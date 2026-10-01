import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

// Revenda de licenças contra um Postgres real: o espelho do indexador (anunciar -> vender -> cancelar, com dados sintéticos),
// a posse da licença, o piso e o histórico do catálogo, os royalties do painel do criador e as rotas HTTP que não precisam de RPC.
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (prefixo "rsltest").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "rsltest";
const AGENT = "0".repeat(24) + "5e5a1e01"; // 32 hex
const AGENT2 = "0".repeat(24) + "5e5a1e02";

describe("revenda com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let drizzle: typeof import("drizzle-orm");
  let mirror: typeof import("../src/indexer/resale-mirror.js");
  let server: Server;
  let base = "";
  let cookie: (wallet: string) => Promise<string>;
  let env: typeof import("../src/env.js").env;

  // Carteiras e licenças com endereços válidos (as rotas validam com `address()`).
  let CREATOR: string, SELLER: string, BUYER: string, THIRD: string;
  let LIC1: string, LIC2: string, LIC3: string, LIC4: string;
  const sig = (n: string) => `${PREFIX}-sig-${n}`;
  let seq = 0;

  const listed = (licenseId: string, o: Partial<import("../src/indexer/resale-mirror.js").ListedInput> = {}) => ({
    licenseId,
    agentId: AGENT,
    listingAddress: `${PREFIX}-pda-${licenseId.slice(0, 6)}`,
    seller: SELLER,
    price: 20_000_000n,
    feeBps: 1000,
    royaltyBps: 500,
    listedAt: new Date("2026-01-15T00:00:00Z"), // antes de todas as vendas dos testes (a venda só fecha anúncio que já existia)
    signature: sig(`list-${++seq}`),
    ...o,
  });
  const activeOf = (licenseId: string) =>
    db.select().from(schema.listings).where(drizzle.and(drizzle.eq(schema.listings.licenseId, licenseId), drizzle.eq(schema.listings.status, "active")));
  const rowsOf = (licenseId: string) => db.select().from(schema.listings).where(drizzle.eq(schema.listings.licenseId, licenseId)).orderBy(schema.listings.id);
  const license = async (id: string) => (await db.select().from(schema.licenses).where(drizzle.eq(schema.licenses.id, id)))[0]!;

  async function cleanup() {
    const { like, inArray } = drizzle;
    const ids = [LIC1, LIC2, LIC3, LIC4].filter(Boolean);
    if (ids.length) await db.delete(schema.listings).where(inArray(schema.listings.licenseId, ids));
    await db.delete(schema.listings).where(like(schema.listings.agentId, "0".repeat(24) + "5e5a1e%"));
    await db.delete(schema.licenses).where(like(schema.licenses.agentId, "0".repeat(24) + "5e5a1e%"));
    await db.delete(schema.chainTxs).where(like(schema.chainTxs.signature, `${PREFIX}%`));
    await db.delete(schema.agents).where(like(schema.agents.slug, `${PREFIX}%`));
    await db.delete(schema.creators).where(like(schema.creators.id, `${PREFIX}%`));
  }

  before(async () => {
    const keys = await Promise.all(Array.from({ length: 8 }, () => generateKeyPairSigner()));
    [CREATOR, SELLER, BUYER, THIRD, LIC1, LIC2, LIC3, LIC4] = keys.map((k) => k.address as string) as [string, string, string, string, string, string, string, string];
    // initChain precisa de um fee payer válido; o RPC aponta para uma porta fechada (falha rápido, nada sai do PC).
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const secret = JSON.stringify([...pkcs8.slice(-32), ...raw]);
    Object.assign(process.env, {
      DATABASE_URL: url,
      USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      FEE_PAYER_KEYPAIR: secret,
      VERIFIER_KEYPAIR: secret,
      USAGE_AUTHORITY_KEYPAIR: secret,
      SOLANA_RPC_URL: "http://127.0.0.1:1",
      RESALE_ENABLED: "true",
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    drizzle = await import("drizzle-orm");
    mirror = await import("../src/indexer/resale-mirror.js");
    ({ env } = await import("../src/env.js"));
    await (await import("../src/chain/index.js")).initChain();
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");
    const { signSession, SESSION_COOKIE } = await import("../src/auth/jwt.js");
    cookie = async (wallet) => `${SESSION_COOKIE}=${await signSession(wallet)}`;

    await cleanup();
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: CREATOR, name: "Criador de teste" });
    for (const [id, slug] of [
      [AGENT, `${PREFIX}-agente`],
      [AGENT2, `${PREFIX}-agente2`],
    ] as const) {
      await db.insert(schema.agents).values({
        id, slug, name: `Agente ${slug}`, tagline: "t", description: "d", category: "Outros", creatorId: `${PREFIX}-creator`,
        version: "1.0.0", versionHash: "ab".repeat(32), price: 20_000_000n, royaltyBps: 500, status: "active", listed: true,
      });
    }
    for (const id of [LIC1, LIC2, LIC3]) {
      await db.insert(schema.licenses).values({ id, agentId: AGENT, ownerWallet: SELLER, acquiredAt: new Date("2026-01-01T00:00:00Z"), signature: sig("compra") });
    }
    await db.insert(schema.licenses).values({ id: LIC4, agentId: AGENT2, ownerWallet: SELLER, acquiredAt: new Date("2026-01-01T00:00:00Z") });
    await new Promise<void>((resolve) => {
      server = createApp(mounts).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    server?.close();
    if (!db) return;
    await cleanup();
    await pool.end();
  });

  // ---------- Espelho do indexador ----------

  it("LicenseListed: abre o anúncio ativo, sinaliza a licença e é idempotente por assinatura", async () => {
    const input = listed(LIC1);
    assert.equal(await mirror.applyListed(input), "inserted");
    assert.equal(await mirror.applyListed(input), "exists"); // mesma assinatura (reprocesso)
    const rows = await rowsOf(LIC1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "active");
    assert.equal(rows[0]!.price, 20_000_000n);
    assert.equal(rows[0]!.openSignature, input.signature);
    const lic = await license(LIC1);
    assert.equal(lic.listedForResale, true);
    assert.equal(lic.resalePrice, 20_000_000n);
  });

  it("o índice único parcial recusa dois anúncios ativos da mesma licença, mas aceita vários fechados", async () => {
    const l = schema.listings;
    const row = { licenseId: LIC1, agentId: AGENT, listingAddress: "x", sellerWallet: SELLER, price: 1n, feeBps: 0, royaltyBps: 0 };
    await assert.rejects(db.insert(l).values({ ...row, status: "active" }), (e: unknown) => (e as { cause?: { code?: string }; code?: string }).cause?.code === "23505" || (e as { code?: string }).code === "23505");
    await db.insert(l).values({ ...row, status: "cancelled" });
    await db.insert(l).values({ ...row, status: "cancelled" });
    await db.delete(l).where(drizzle.and(drizzle.eq(l.licenseId, LIC1), drizzle.eq(l.status, "cancelled")));
  });

  it("relistar com outra assinatura enquanto há um ativo: o antigo vira 'invalid' e só um fica ativo", async () => {
    await mirror.applyListed(listed(LIC1, { price: 18_000_000n }));
    const rows = await rowsOf(LIC1);
    assert.deepEqual(rows.map((r) => r.status), ["invalid", "active"]);
    assert.equal((await activeOf(LIC1))[0]!.price, 18_000_000n);
    assert.equal((await license(LIC1)).resalePrice, 18_000_000n);
  });

  it("reconciliação sem assinatura não duplica o anúncio ativo idêntico", async () => {
    const active = (await activeOf(LIC1))[0]!;
    const out = await mirror.applyListed(listed(LIC1, { price: active.price, signature: null }));
    assert.equal(out, "exists");
    assert.equal((await rowsOf(LIC1)).length, 2);
  });

  it("LicenseResold: fecha como 'sold' com royalty/taxa/líquido DO EVENTO e limpa os sinais", async () => {
    const sale = {
      licenseId: LIC1, agentId: AGENT, listingAddress: `${PREFIX}-pda-${LIC1.slice(0, 6)}`, seller: SELLER, buyer: BUYER,
      price: 18_000_000n, royalty: 900_000n, fee: 1_800_000n, sellerAmount: 15_300_000n, signature: sig("venda1"), blockTime: new Date("2026-02-01T12:00:00Z"),
    };
    const row = await mirror.applySold(sale);
    assert.equal(row.status, "sold");
    assert.equal(row.buyerWallet, BUYER);
    assert.equal(row.soldPrice, 18_000_000n);
    assert.equal(row.royalty, 900_000n);
    assert.equal(row.fee, 1_800_000n);
    assert.equal(row.sellerAmount, 15_300_000n);
    assert.equal(row.royalty + row.fee + row.sellerAmount, row.price);
    assert.equal(row.closeSignature, sig("venda1"));
    assert.equal((await activeOf(LIC1)).length, 0);
    // Reprocessar o mesmo evento é inofensivo.
    const again = await mirror.applySold(sale);
    assert.equal(again.id, row.id);
    assert.equal((await rowsOf(LIC1)).filter((r) => r.status === "sold").length, 1);
  });

  it("novo dono: syncLicense (upsertLicenseRow) troca acquired_at e signature e zera os sinais de anúncio", async () => {
    // Antes: o vendedor ainda aparece como dono, com a data da compra original.
    const before = await license(LIC1);
    assert.equal(before.ownerWallet, SELLER);
    assert.equal(before.acquiredAt.toISOString(), "2026-01-01T00:00:00.000Z");
    const when = new Date("2026-02-01T12:00:00Z");
    await mirror.upsertLicenseRow({ asset: LIC1, agentId: AGENT, owner: BUYER, acquiredAt: when, signature: sig("venda1") });
    const after = await license(LIC1);
    assert.equal(after.ownerWallet, BUYER);
    assert.equal(after.acquiredAt.toISOString(), when.toISOString());
    assert.equal(after.signature, sig("venda1"));
    assert.equal(after.listedForResale, false);
    assert.equal(after.resalePrice, null);
  });

  it("mesmo dono: syncLicense não mexe em acquired_at nem em signature", async () => {
    await mirror.upsertLicenseRow({ asset: LIC1, agentId: AGENT, owner: BUYER, acquiredAt: new Date("2030-01-01T00:00:00Z"), signature: "outra" });
    const lic = await license(LIC1);
    assert.equal(lic.acquiredAt.toISOString(), "2026-02-01T12:00:00.000Z");
    assert.equal(lic.signature, sig("venda1"));
  });

  it("reprocessar uma venda ANTIGA depois de o novo dono relistar não fecha o anúncio novo", async () => {
    await mirror.applyListed(listed(LIC1, { seller: BUYER, price: 25_000_000n }));
    const old = await mirror.applySold({
      licenseId: LIC1, agentId: AGENT, listingAddress: "x", seller: SELLER, buyer: BUYER,
      price: 18_000_000n, royalty: 900_000n, fee: 1_800_000n, sellerAmount: 15_300_000n, signature: sig("venda1"), blockTime: null,
    });
    assert.equal(old.status, "sold");
    assert.equal(old.sellerWallet, SELLER);
    const active = await activeOf(LIC1);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.sellerWallet, BUYER);
    assert.equal(active[0]!.price, 25_000_000n);
    assert.equal((await license(LIC1)).resalePrice, 25_000_000n);
  });

  it("ListingCancelled: o vendedor cancela ('cancelled'); reprocessar não faz nada", async () => {
    const input = { licenseId: LIC1, seller: BUYER, canceller: BUYER, signature: sig("cancela1"), blockTime: null };
    assert.equal(await mirror.applyCancelled(input), "closed");
    assert.equal((await rowsOf(LIC1)).at(-1)!.status, "cancelled");
    assert.equal((await license(LIC1)).listedForResale, false);
    assert.equal(await mirror.applyCancelled(input), "none");
  });

  it("ListingCancelled de terceiro num anúncio velho vira 'invalid'", async () => {
    await mirror.applyListed(listed(LIC2));
    assert.equal(await mirror.applyCancelled({ licenseId: LIC2, seller: SELLER, canceller: THIRD, signature: sig("cancela2"), blockTime: null }), "closed");
    assert.equal((await rowsOf(LIC2)).at(-1)!.status, "invalid");
  });

  it("cancelar o velho e anunciar de novo na MESMA transação: reprocessar o cancelamento não fecha o anúncio novo", async () => {
    await mirror.applyListed(listed(LIC2, { price: 10_000_000n })); // anúncio velho
    const same = sig("troca");
    await mirror.applyCancelled({ licenseId: LIC2, seller: SELLER, canceller: SELLER, signature: same, blockTime: null });
    await mirror.applyListed(listed(LIC2, { price: 12_000_000n, signature: same }));
    // reprocesso da transação inteira, na mesma ordem dos eventos
    await mirror.applyCancelled({ licenseId: LIC2, seller: SELLER, canceller: SELLER, signature: same, blockTime: null });
    await mirror.applyListed(listed(LIC2, { price: 12_000_000n, signature: same }));
    const active = await activeOf(LIC2);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.price, 12_000_000n);
  });

  it("posse mudou fora da plataforma (refresh): anúncio ativo de outro vendedor vira 'invalid' e os sinais caem", async () => {
    assert.equal((await activeOf(LIC2)).length, 1);
    await mirror.setLicenseOwner(LIC2, THIRD);
    assert.equal((await activeOf(LIC2)).length, 0);
    assert.equal((await rowsOf(LIC2)).at(-1)!.status, "invalid");
    const lic = await license(LIC2);
    assert.equal(lic.ownerWallet, THIRD);
    assert.equal(lic.listedForResale, false);
    assert.equal(lic.resalePrice, null);
    assert.notEqual(lic.acquiredAt.toISOString(), "2026-01-01T00:00:00.000Z");
  });

  it("posse igual ao vendedor: o anúncio continua ativo", async () => {
    await mirror.applyListed(listed(LIC3));
    await mirror.setLicenseOwner(LIC3, SELLER);
    assert.equal((await activeOf(LIC3)).length, 1);
    assert.equal((await license(LIC3)).listedForResale, true);
  });

  it("a venda chega DEPOIS de um refresh que já fechou o anúncio como 'invalid': vira 'sold' (não duplica)", async () => {
    await mirror.setLicenseOwner(LIC3, BUYER); // o refresh viu o novo dono primeiro
    assert.equal((await rowsOf(LIC3)).at(-1)!.status, "invalid");
    const sold = await mirror.applySold({
      licenseId: LIC3, agentId: AGENT, listingAddress: "x", seller: SELLER, buyer: BUYER,
      price: 20_000_000n, royalty: 1_000_000n, fee: 2_000_000n, sellerAmount: 17_000_000n, signature: sig("venda3"), blockTime: new Date("2026-03-01T00:00:00Z"),
    });
    assert.equal(sold.status, "sold");
    assert.equal((await rowsOf(LIC3)).length, 1);
    await mirror.markLicenseAcquired(LIC3, BUYER, new Date("2026-03-01T00:00:00Z"), sig("venda3"));
    assert.equal((await license(LIC3)).acquiredAt.toISOString(), "2026-03-01T00:00:00.000Z");
  });

  it("venda de anúncio nunca indexado: grava uma linha 'sold' só com o que o evento diz", async () => {
    const sold = await mirror.applySold({
      licenseId: LIC4, agentId: AGENT2, listingAddress: "y", seller: SELLER, buyer: BUYER,
      price: 10_000_000n, royalty: 500_000n, fee: 1_000_000n, sellerAmount: 8_500_000n, signature: sig("venda4"), blockTime: new Date("2026-03-05T00:00:00Z"),
    });
    assert.equal(sold.status, "sold");
    assert.equal(sold.openSignature, null);
    assert.equal(sold.royaltyBps, 500);
    assert.equal(sold.feeBps, 1000);
  });

  it("licença queimada: some do espelho e fecha o anúncio ativo", async () => {
    await mirror.applyListed(listed(LIC1, { seller: BUYER }));
    assert.equal((await activeOf(LIC1)).length, 1);
    await mirror.removeLicenseRow(LIC1);
    assert.equal((await activeOf(LIC1)).length, 0);
    assert.equal((await db.select().from(schema.licenses).where(drizzle.eq(schema.licenses.id, LIC1))).length, 0);
  });

  // ---------- Catálogo e painel do criador ----------

  it("piso do catálogo = anúncio ativo mais barato do solver; histórico = vendas por closed_at; some com a flag desligada", async () => {
    // Estado: AGENT tem vendas (LIC1 18 USDC em fev, LIC3 20 USDC em mar); anúncios ativos novos abaixo.
    await db.delete(schema.listings).where(drizzle.and(drizzle.eq(schema.listings.agentId, AGENT), drizzle.eq(schema.listings.status, "active")));
    await db.insert(schema.licenses).values({ id: `${PREFIX}-extra-a`, agentId: AGENT, ownerWallet: SELLER }).onConflictDoNothing();
    await db.insert(schema.licenses).values({ id: `${PREFIX}-extra-b`, agentId: AGENT, ownerWallet: SELLER }).onConflictDoNothing();
    await mirror.applyListed(listed(`${PREFIX}-extra-a`, { price: 16_000_000n }));
    await mirror.applyListed(listed(`${PREFIX}-extra-b`, { price: 14_500_000n }));
    const { agentExtras } = await import("../src/store/catalog.js");
    const ex = (await agentExtras([AGENT, AGENT2])).get(AGENT)!;
    assert.equal(ex.resaleFloor, 14_500_000n);
    assert.equal(ex.resaleListingId, `${PREFIX}-extra-b`);
    assert.equal((await agentExtras([AGENT2])).get(AGENT2)!.resaleFloor, null); // AGENT2 só tem venda, nenhum anúncio ativo

    const res = await fetch(`${base}/api/agents/${PREFIX}-agente`);
    assert.equal(res.status, 200);
    const detail = (await res.json()) as { agent: { resaleFloorUsdc: number | null; royaltyBps: number }; resaleListingId: string | null; resalePriceHistory: Array<{ date: string; priceUsdc: number }> };
    assert.equal(detail.agent.resaleFloorUsdc, 14.5);
    assert.equal(detail.agent.royaltyBps, 500);
    assert.equal(detail.resaleListingId, `${PREFIX}-extra-b`);
    assert.deepEqual(detail.resalePriceHistory.map((p) => p.priceUsdc), [18, 20]); // cronológico: fev, depois mar
    assert.equal(detail.resalePriceHistory[0]!.date, "2026-02-01T12:00:00.000Z");

    env.RESALE_ENABLED = false;
    try {
      assert.equal((await agentExtras([AGENT])).get(AGENT)!.resaleFloor, null);
      const off = (await (await fetch(`${base}/api/agents/${PREFIX}-agente`)).json()) as { resaleListingId: string | null; resalePriceHistory: unknown[] };
      assert.equal(off.resaleListingId, null);
      assert.deepEqual(off.resalePriceHistory, []); // histórico também some com a flag desligada
    } finally {
      env.RESALE_ENABLED = true;
    }
  });

  it("GET /market/listings: anúncios ativos do solver, mais barato primeiro, com tendência e reputação do vendedor", async () => {
    await db.insert(schema.userReputation).values({ wallet: SELLER, purchases: 4, disputesOpened: 0, disputesLost: 0 }).onConflictDoNothing();
    const res = await fetch(`${base}/api/market/listings?agent=${PREFIX}-agente`);
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ id: string; priceUsdc: number; priceTrendPct: number; sellerWallet: string; sellerReputation: number | null; royaltyBps: number; feeBps: number; agent: { slug: string }; license: { id: string; listedForResale: boolean } }>;
    assert.deepEqual(list.map((l) => l.id), [`${PREFIX}-extra-b`, `${PREFIX}-extra-a`]);
    const first = list[0]!;
    assert.equal(first.priceUsdc, 14.5);
    assert.equal(first.agent.slug, `${PREFIX}-agente`);
    assert.equal(first.license.id, `${PREFIX}-extra-b`);
    assert.equal(first.sellerWallet, SELLER);
    assert.equal(first.royaltyBps, 500);
    assert.equal(first.feeBps, 1000);
    // média das vendas do solver = 19 USDC; 14,5 fica -23,7% abaixo
    assert.equal(first.priceTrendPct, -23.7);
    assert.equal(first.sellerReputation, 56); // 50 + 4 * 1,5
    assert.ok(!("simulated" in first));
    // um anúncio por licença (checkout): sem o teto da listagem geral e sem depender do filtro de solver
    const one = (await (await fetch(`${base}/api/market/listings?license=${LIC3}`)).json()) as unknown[];
    assert.deepEqual(one, []); // LIC3 foi vendida: sem anúncio ativo
    const bad = await fetch(`${base}/api/market/listings?license=nao-e-endereco`);
    assert.equal(bad.status, 400);
    // solver sem anúncio ativo, e solver que não existe
    assert.deepEqual(await (await fetch(`${base}/api/market/listings?agent=${PREFIX}-agente2`)).json(), []);
    assert.deepEqual(await (await fetch(`${base}/api/market/listings?agent=${PREFIX}-nao-existe`)).json(), []);
    // sem filtro traz também outros solvers; vendedor sem histórico: reputação nula
    await db.delete(schema.userReputation).where(drizzle.eq(schema.userReputation.wallet, SELLER));
    const noRep = (await (await fetch(`${base}/api/market/listings`)).json()) as Array<{ id: string; sellerReputation: number | null }>;
    assert.equal(noRep.find((l) => l.id === `${PREFIX}-extra-b`)!.sellerReputation, null);
  });

  it("solver suspenso some do mercado; flag desligada responde []", async () => {
    await db.update(schema.agents).set({ platformStatus: "suspended" }).where(drizzle.eq(schema.agents.id, AGENT));
    assert.deepEqual(await (await fetch(`${base}/api/market/listings?agent=${PREFIX}-agente`)).json(), []);
    await db.update(schema.agents).set({ platformStatus: "active" }).where(drizzle.eq(schema.agents.id, AGENT));
    env.RESALE_ENABLED = false;
    try {
      assert.deepEqual(await (await fetch(`${base}/api/market/listings?agent=${PREFIX}-agente`)).json(), []);
    } finally {
      env.RESALE_ENABLED = true;
    }
  });

  it("painel do criador: royaltiesUsdc = soma dos royalties das vendas; revenda não entra na receita de vendas", async () => {
    // Vendas 'sold' do AGENT: LIC1 (0,9) e LIC3 (1,0); AGENT2: LIC4 (0,5) = 2,4 USDC.
    await db.insert(schema.chainTxs).values({
      signature: sig("tx-resale"), kind: "resale", wallet: BUYER, agentId: AGENT, amount: 18_000_000n, fee: 1_800_000n, creatorAmount: 900_000n, feeBps: 1000, blockTime: new Date(),
    });
    const res = await fetch(`${base}/api/creator/dashboard`, { headers: { cookie: await cookie(CREATOR) } });
    assert.equal(res.status, 200);
    const dash = (await res.json()) as { totals: { royaltiesUsdc: number; salesRevenueUsdc: number; sales: number } };
    assert.equal(dash.totals.royaltiesUsdc, 2.4);
    assert.equal(dash.totals.salesRevenueUsdc, 0);
    assert.equal(dash.totals.sales, 0); // revenda não incrementa total_sales
    const daily = (await (await fetch(`${base}/api/creator/dashboard`, { headers: { cookie: await cookie(CREATOR) } })).json()) as { daily: unknown[] };
    assert.deepEqual(daily.daily, [], "uma linha 'resale' não cria dia de zeros no painel");
  });

  // ---------- Rotas HTTP que não precisam de RPC ----------

  const post = async (path: string, wallet: string | null, body: unknown) =>
    fetch(`${base}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...(wallet ? { cookie: await cookie(wallet) } : {}) }, body: JSON.stringify(body) });

  it("sem login: 401 nas três rotas de transação", async () => {
    for (const path of ["/tx/list", "/tx/buy-listing", "/tx/cancel-listing"]) assert.equal((await post(path, null, {})).status, 401, path);
  });

  it("flag desligada: anunciar e comprar respondem 503 resale_disabled; cancelar NUNCA responde isso", async () => {
    env.RESALE_ENABLED = false;
    try {
      for (const [path, body] of [
        ["/tx/list", { licenseId: LIC1, priceUsdc: 10 }],
        ["/tx/buy-listing", { licenseId: LIC1, expectedPriceUsdc: 10 }],
      ] as const) {
        const res = await post(path, BUYER, body);
        assert.equal(res.status, 503, path);
        assert.equal(((await res.json()) as { code: string }).code, "resale_disabled", path);
      }
      const cancel = await post("/tx/cancel-listing", BUYER, { licenseId: LIC1 });
      assert.notEqual(((await cancel.json()) as { code?: string }).code, "resale_disabled");
    } finally {
      env.RESALE_ENABLED = true;
    }
  });

  it("corpo inválido: 400 validation", async () => {
    for (const [path, body] of [
      ["/tx/list", { licenseId: LIC1 }],
      ["/tx/buy-listing", { licenseId: "curto", expectedPriceUsdc: 5 }],
      ["/tx/cancel-listing", {}],
      // B3: base58 inválido (tamanho certo, caractere fora do alfabeto, comprido demais) é 400 e não 500 em address()
      ["/tx/cancel-listing", { licenseId: "0".repeat(40) }],
      ["/tx/cancel-listing", { licenseId: "x".repeat(44) }],
      ["/tx/list", { licenseId: "O".repeat(40), priceUsdc: 10 }],
      ["/tx/buy-listing", { licenseId: "l".repeat(40), expectedPriceUsdc: 10 }],
    ] as const) {
      const res = await post(path, BUYER, body);
      assert.equal(res.status, 400, path);
      assert.equal(((await res.json()) as { code: string }).code, "validation", path);
    }
  });

  it("comprar: sem anúncio ativo é 404 listing_not_found; o próprio anúncio é 400 own_listing", async () => {
    const gone = await post("/tx/buy-listing", BUYER, { licenseId: LIC4, expectedPriceUsdc: 10 });
    assert.equal(gone.status, 404);
    assert.equal(((await gone.json()) as { code: string }).code, "listing_not_found");

    await mirror.applyListed(listed(LIC2, { price: 9_000_000n }));
    const mine = await post("/tx/buy-listing", SELLER, { licenseId: LIC2, expectedPriceUsdc: 9 });
    assert.equal(mine.status, 400);
    assert.equal(((await mine.json()) as { code: string }).code, "own_listing");
  });

  it("comprar: preço com mais de 6 casas é recusado (validation), sem arredondar", async () => {
    const res = await post("/tx/buy-listing", BUYER, { licenseId: LIC2, expectedPriceUsdc: 9.0000001 });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, "validation");
  });

  // ---------- Concorrência e ordem dos eventos ----------

  const saleOf = (licenseId: string, signature: string, blockTime: Date | null) => ({
    licenseId, agentId: AGENT2, listingAddress: `${PREFIX}-pda-x`, seller: SELLER, buyer: BUYER,
    price: 10_000_000n, royalty: 500_000n, fee: 1_000_000n, sellerAmount: 8_500_000n, signature, blockTime,
  });

  it("o mesmo evento LicenseResold processado em paralelo (3x) grava UMA venda, com e sem anúncio indexado", async () => {
    const withListing = `${PREFIX}-conc-a`;
    const never = `${PREFIX}-conc-b`;
    for (const id of [withListing, never]) await db.insert(schema.licenses).values({ id, agentId: AGENT2, ownerWallet: SELLER }).onConflictDoNothing();
    await mirror.applyListed(listed(withListing, { agentId: AGENT2, price: 10_000_000n }));
    for (const [id, signature] of [[withListing, sig("conc-a")], [never, sig("conc-b")]] as const) {
      const out = await Promise.all([1, 2, 3].map(() => mirror.applySold(saleOf(id, signature, new Date("2026-04-01T00:00:00Z")))));
      assert.equal(new Set(out.map((r) => r.id)).size, 1, "as três chamadas devolvem a mesma linha");
      const sold = (await rowsOf(id)).filter((r) => r.status === "sold");
      assert.equal(sold.length, 1, id);
      assert.equal(sold[0]!.closeSignature, signature);
    }
  });

  it("o índice único (license_id, close_signature) onde status='sold' recusa uma segunda venda da mesma assinatura", async () => {
    const l = schema.listings;
    const row = { licenseId: `${PREFIX}-conc-b`, agentId: AGENT2, listingAddress: "x", sellerWallet: SELLER, price: 1n, feeBps: 0, royaltyBps: 0, status: "sold", closeSignature: sig("conc-b") };
    await assert.rejects(db.insert(l).values(row), (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505" || (e as { code?: string }).code === "23505");
    // outra assinatura ou outro status não colidem
    await db.insert(l).values({ ...row, closeSignature: sig("outra-venda") });
    await db.insert(l).values({ ...row, status: "cancelled" });
  });

  it("venda ANTIGA processada tarde não fecha o anúncio NOVO (listed_at depois do bloco da venda)", async () => {
    const id = `${PREFIX}-b2`;
    await db.insert(schema.licenses).values({ id, agentId: AGENT2, ownerWallet: SELLER }).onConflictDoNothing();
    await mirror.applyListed(listed(id, { agentId: AGENT2, price: 30_000_000n, listedAt: new Date("2026-06-01T00:00:00Z") }));
    const old = await mirror.applySold(saleOf(id, sig("venda-antiga"), new Date("2026-02-01T00:00:00Z")));
    assert.equal(old.status, "sold");
    assert.notEqual(old.price, 30_000_000n); // linha própria da venda antiga, não o anúncio novo
    const active = await activeOf(id);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.price, 30_000_000n);
    // uma venda posterior ao anúncio fecha o anúncio normalmente
    const later = await mirror.applySold(saleOf(id, sig("venda-nova"), new Date("2026-07-01T00:00:00Z")));
    assert.equal(later.id, active[0]!.id);
    assert.equal((await activeOf(id)).length, 0);
  });

  it("resoldOwner: venda recente manda o comprador (leitura atrasada); venda antiga confia na cadeia", async () => {
    const sale = { seller: SELLER, buyer: BUYER };
    assert.equal(mirror.resoldOwner(SELLER, sale, true), BUYER); // RPC ainda mostrava o vendedor
    assert.equal(mirror.resoldOwner(BUYER, sale, true), BUYER);
    assert.equal(mirror.resoldOwner(THIRD, sale, true), THIRD); // houve transferência depois
    assert.equal(mirror.resoldOwner(SELLER, sale, false), SELLER); // reprocesso antigo: vale a cadeia
  });

  it("GET /config: resaleFeeBps é null quando a config on-chain não pôde ser lida", async () => {
    const res = await fetch(`${base}/api/config`);
    assert.equal(res.status, 200);
    const cfg = (await res.json()) as { resaleEnabled: boolean; resaleFeeBps: number | null; resaleMaxCutBps: number; feeBps: number | null };
    assert.equal(cfg.resaleEnabled, true);
    assert.equal(cfg.resaleFeeBps, null);
    assert.equal(cfg.resaleMaxCutBps, 5000);
  });

  it("/me/profile: o histórico rotula a compra de revenda", async () => {
    const res = await fetch(`${base}/api/me/profile`, { headers: { cookie: await cookie(BUYER) } });
    assert.equal(res.status, 200);
    const profile = (await res.json()) as { history: Array<{ kind: string; label: string }> };
    assert.deepEqual(profile.history.find((h) => h.kind === "resale")?.label, "Compra de licença revendida");
  });
});

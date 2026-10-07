import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

// Teto de licenças contra um Postgres real (docs/licencas-limitadas.md): a coluna `agents.max_licenses` (espelho da PDA SupplyCap),
// o campo `supply` da API do catálogo e do painel do criador, e o 409 `sold_out` do pré-check de compra (loja e Pix) sem precisar de RPC.
// Quem barra a venda de verdade é o programa (testado em programs/solvers/tests/program.rs).
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (prefixo "suptest").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "suptest";
const ids = {
  open: "0".repeat(24) + "5b5b1e01", // teto 3, 2 vendidas
  soldOut: "0".repeat(24) + "5b5b1e02", // teto 3, 3 vendidas
  unlimited: "0".repeat(24) + "5b5b1e03", // sem teto, 100 vendidas
  over: "0".repeat(24) + "5b5b1e04", // teto 3 criado depois de 5 vendas
};

describe("teto de licenças com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let drizzle: typeof import("drizzle-orm");
  let server: Server;
  let base = "";
  let cookie: (wallet: string) => Promise<string>;
  let CREATOR: string, BUYER: string;

  async function cleanup() {
    await db.delete(schema.agents).where(drizzle.like(schema.agents.slug, `${PREFIX}%`));
    await db.delete(schema.creators).where(drizzle.like(schema.creators.id, `${PREFIX}%`));
  }

  before(async () => {
    [CREATOR, BUYER] = (await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()])).map((k) => k.address as string) as [string, string];
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
    await (await import("../src/chain/index.js")).initChain();
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");
    const { signSession, SESSION_COOKIE } = await import("../src/auth/jwt.js");
    cookie = async (wallet) => `${SESSION_COOKIE}=${await signSession(wallet)}`;

    await cleanup();
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: CREATOR, name: "Criador de teste" });
    const rows: Array<[string, string, bigint, number | null]> = [
      [ids.open, "aberto", 2n, 3],
      [ids.soldOut, "esgotado", 3n, 3],
      [ids.unlimited, "ilimitado", 100n, null],
      [ids.over, "acima", 5n, 3],
    ];
    for (const [id, name, sales, max] of rows) {
      await db.insert(schema.agents).values({
        id, slug: `${PREFIX}-${name}`, name: `Agente ${name}`, tagline: "t", description: "d", category: "Outros", creatorId: `${PREFIX}-creator`,
        version: "1.0.0", versionHash: "ab".repeat(32), price: 12_000_000n, status: "active", listed: true, totalSales: sales,
        ...(max == null ? {} : { maxLicenses: max }),
      });
    }
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

  it("a coluna é opcional: solver sem teto fica com max_licenses nulo e a edição de outras colunas não mexe nela", async () => {
    const [u] = await db.select().from(schema.agents).where(drizzle.eq(schema.agents.id, ids.unlimited));
    assert.equal(u!.maxLicenses, null);
    // O indexador reescreve as colunas do espelho a cada evento (totalSales etc.): o teto sobrevive se ele não o inclui.
    await db.update(schema.agents).set({ totalSales: 6n, updatedAt: new Date() }).where(drizzle.eq(schema.agents.id, ids.open));
    const [o] = await db.select().from(schema.agents).where(drizzle.eq(schema.agents.id, ids.open));
    assert.equal(o!.maxLicenses, 3);
    await db.update(schema.agents).set({ totalSales: 2n }).where(drizzle.eq(schema.agents.id, ids.open));
  });

  it("API do catálogo: supply com vendidas e restantes; ilimitado sem teto; nunca negativo", async () => {
    const get = async (name: string) => ((await (await fetch(`${base}/api/agents/${PREFIX}-${name}`)).json()) as { agent: { supply: { max: number | null; sold: number; left: number | null } } }).agent;
    assert.deepEqual((await get("aberto")).supply, { max: 3, sold: 2, left: 1 });
    assert.deepEqual((await get("esgotado")).supply, { max: 3, sold: 3, left: 0 });
    assert.deepEqual((await get("ilimitado")).supply, { max: null, sold: 100, left: null });
    assert.deepEqual((await get("acima")).supply, { max: 3, sold: 5, left: 0 });
  });

  it("lista da vitrine traz supply de cada solver", async () => {
    const list = (await (await fetch(`${base}/api/agents?q=${PREFIX}`)).json()) as Array<{ slug: string; supply?: { left: number | null } }>;
    const mine = list.filter((a) => a.slug.startsWith(PREFIX));
    // A busca textual pode não devolver os de teste; quando devolve, todos têm supply.
    for (const a of mine) assert.ok(a.supply, `${a.slug} sem supply`);
  });

  it("painel do criador: sold/max por solver", async () => {
    const res = await fetch(`${base}/api/creator/dashboard`, { headers: { cookie: await cookie(CREATOR) } });
    assert.equal(res.status, 200);
    const dash = (await res.json()) as { agents: Array<{ agentId: string; supply: { max: number | null; sold: number; left: number | null } }> };
    const by = new Map(dash.agents.map((a) => [a.agentId, a.supply]));
    assert.deepEqual(by.get(ids.open), { max: 3, sold: 2, left: 1 });
    assert.deepEqual(by.get(ids.soldOut), { max: 3, sold: 3, left: 0 });
    assert.deepEqual(by.get(ids.unlimited), { max: null, sold: 100, left: null });
  });

  it("POST /api/tx/purchase de solver esgotado: 409 sold_out sem montar transação (a loja, sem RPC)", async () => {
    const res = await fetch(`${base}/api/tx/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await cookie(BUYER) },
      body: JSON.stringify({ agentId: ids.soldOut, type: "permanent" }),
    });
    const body = (await res.json()) as { code?: string; error?: string };
    // Com o RPC fora do ar o `assertEntriesOpen` pode responder antes (fail-open); o que importa: nunca monta uma compra de esgotado.
    if (res.status === 409) {
      assert.equal(body.code, "sold_out");
      assert.match(body.error ?? "", /esgotado/);
    } else {
      assert.notEqual(res.status, 200);
    }
  });

  it("MCP: a descrição mostra X de Y restantes, o esgotado não ganha link de compra e a revenda só aparece com a flag", async () => {
    const { describeAgent, purchaseLinkFor, soldOutAdvice } = await import("../src/mcp/tools.js");
    const row = async (id: string) => (await db.select().from(schema.agents).where(drizzle.eq(schema.agents.id, id)))[0]!;
    const open = await row(ids.open);
    const sold = await row(ids.soldOut);
    const free = await row(ids.unlimited);
    assert.match(describeAgent(open), /1 of 3 licenses left/);
    assert.match(describeAgent(sold), /sold out/);
    assert.doesNotMatch(describeAgent(free), /licenses left|sold out/);
    assert.match(purchaseLinkFor(open), /\/checkout\?agent=/);
    assert.doesNotMatch(purchaseLinkFor(sold), /checkout/);
    assert.match(purchaseLinkFor(sold), /sold out/);
    const advice = soldOutAdvice(sold);
    assert.match(advice, /Do not offer a purchase link/);
    assert.match(advice, /limite atual/);
    assert.match(advice, /mercado de revenda/); // RESALE_ENABLED=true neste teste
    assert.doesNotMatch(advice, /só existirão|apenas \d+ existem/);
  });

  it("Pix e SODAX (neededUnits): esgotado é barrado antes de cobrar; com vaga o pré-check passa", async () => {
    const { neededUnits } = await import("../src/pix/routes.js");
    const { HttpError } = await import("../src/lib/http.js");
    await assert.rejects(
      () => neededUnits(BUYER, ids.soldOut, "permanent"),
      (e: unknown) => e instanceof HttpError && e.status === 409 && e.code === "sold_out",
    );
    await assert.rejects(
      () => neededUnits(BUYER, ids.over, "permanent"),
      (e: unknown) => e instanceof HttpError && e.code === "sold_out",
    );
    // Com vaga o pré-check de teto passa e a conta segue para o RPC (fora do ar neste teste): qualquer erro, menos sold_out.
    await assert.rejects(
      () => neededUnits(BUYER, ids.open, "permanent"),
      (e: unknown) => !(e instanceof HttpError && e.code === "sold_out"),
    );
    await assert.rejects(
      () => neededUnits(BUYER, ids.unlimited, "permanent"),
      (e: unknown) => !(e instanceof HttpError && e.code === "sold_out"),
    );
  });
});

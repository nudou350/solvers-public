import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

// Pedido de ajuda ao criador contra um Postgres real, pela rota HTTP de verdade (sem token do Telegram: o aviso fica só no banco).
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "helptest";
const AGENT = "0".repeat(24) + "he1p0001";
const BUYER = `${PREFIX}-buyer`;
const OLD = `${PREFIX}-old`; // só tem pedidos de mais de 1 hora atrás

describe("pedido de ajuda com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let like: typeof import("drizzle-orm").like;
  let eq: typeof import("drizzle-orm").eq;
  let server: Server;
  let base = "";
  let cookie: (wallet: string) => Promise<string>;

  const help = async (wallet: string | null, body: unknown, slug = `${PREFIX}-agente`) =>
    fetch(`${base}/api/agents/${slug}/help`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(wallet ? { cookie: await cookie(wallet) } : {}) },
      body: JSON.stringify(body),
    });

  async function cleanup() {
    await db.delete(schema.escalations).where(like(schema.escalations.wallet, `${PREFIX}%`));
    await db.delete(schema.agents).where(like(schema.agents.slug, `${PREFIX}%`));
    await db.delete(schema.creators).where(like(schema.creators.id, `${PREFIX}%`));
  }

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
    ({ like, eq } = await import("drizzle-orm"));
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");
    const { signSession, SESSION_COOKIE } = await import("../src/auth/jwt.js");
    cookie = async (wallet) => `${SESSION_COOKIE}=${await signSession(wallet)}`;

    await cleanup();
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: `${PREFIX}-creator-wallet`, name: "Criador de teste", telegramChatId: "999000111" });
    await db.insert(schema.agents).values({
      id: AGENT, slug: `${PREFIX}-agente`, name: "Agente de teste", tagline: "t", description: "d", category: "Outros",
      creatorId: `${PREFIX}-creator`, version: "1.0.0", versionHash: "ab".repeat(32), price: 5_000_000n, status: "active", listed: true,
    });
    await new Promise<void>((resolve) => {
      server = createApp(mounts).listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    server?.close();
    if (!db) return;
    await cleanup();
    await pool.end();
  });

  it("sem login: 401", async () => {
    assert.equal((await help(null, { message: "Travei no passo 2 da instalação" })).status, 401);
  });

  it("mensagem curta: 400 validation; especialista que não existe: 404", async () => {
    const curta = await help(BUYER, { message: "oi" });
    assert.equal(curta.status, 400);
    assert.equal(((await curta.json()) as { code: string }).code, "validation");
    assert.equal((await help(BUYER, { message: "Travei no passo 2 da instalação" }, `${PREFIX}-nao-existe`)).status, 404);
    const rows = await db.select().from(schema.escalations).where(eq(schema.escalations.wallet, BUYER));
    assert.equal(rows.length, 0, "pedido recusado não abre chamado");
  });

  it("abre o chamado com protocolo, mensagem e contato; a resposta não vaza dado do criador", async () => {
    const res = await help(BUYER, { message: "Travei no passo 2 da instalação", contact: "ana@exemplo.com" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { protocol: string; notified: boolean };
    assert.match(body.protocol, /^SLV-/);
    assert.equal(body.notified, false, "sem token do Telegram, só registra");
    assert.deepEqual(Object.keys(body).sort(), ["notified", "protocol"]);
    assert.ok(!JSON.stringify(body).includes("999000111"), "o chat do criador não sai do servidor");

    const [row] = await db.select().from(schema.escalations).where(eq(schema.escalations.id, body.protocol));
    assert.equal(row!.wallet, BUYER);
    assert.equal(row!.agentId, AGENT);
    assert.match(row!.summary, /Contact for reply: ana@exemplo\.com/);
    assert.match(row!.summary, /Travei no passo 2 da instalação/);
  });

  it("limite: 3 pedidos por hora por carteira; o 4º volta 429 e não abre chamado", async () => {
    for (let i = 0; i < 2; i++) assert.equal((await help(BUYER, { message: `Outro problema número ${i} na instalação` })).status, 200);
    const quarto = await help(BUYER, { message: "Mais um problema na instalação" });
    assert.equal(quarto.status, 429);
    assert.equal(((await quarto.json()) as { code: string }).code, "rate_limited");
    const rows = await db.select().from(schema.escalations).where(eq(schema.escalations.wallet, BUYER));
    assert.equal(rows.length, 3);
  });

  it("o limite é por carteira e pedidos de mais de 1 hora não contam", async () => {
    const old = new Date(Date.now() - 2 * 3600_000);
    for (let i = 0; i < 3; i++) await db.insert(schema.escalations).values({ id: `SLV-${PREFIX}${i}`, wallet: OLD, agentId: AGENT, summary: "antigo", createdAt: old });
    assert.equal((await help(OLD, { message: "Voltei com uma dúvida nova na instalação" })).status, 200);
    assert.equal((await help(`${PREFIX}-outra`, { message: "Sou outra pessoa com uma dúvida na instalação" })).status, 200);
  });
});

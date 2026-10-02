import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

// Vinculação do Telegram do criador contra um Postgres real: a rota que gera o código (createApp + signSession), o resgate pelo
// bot (processUpdate com o Telegram de mentira e o banco de verdade) e os avisos que passam a ir para o chat vinculado.
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.
// Nenhum token real: o do Telegram abaixo é de mentira e o fetch global é trocado, então nada sai para a rede.

const url = process.env.TEST_DATABASE_URL;
const P = "tgl";
const FAKE_TOKEN = "000000:token-de-mentira";
const ADMIN_CHAT = "777000";
const AGENT = "0".repeat(24) + "7e1e0001";

describe("vinculação do Telegram com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let eq: typeof import("drizzle-orm").eq;
  let like: typeof import("drizzle-orm").like;
  let rules: typeof import("../src/telegram/link-rules.js");
  let store: typeof import("../src/telegram/link-store.js");
  let poller: typeof import("../src/telegram/poller.js");
  let notify: typeof import("../src/submissions/notify.js");
  let tg: typeof import("../src/notify/telegram.js");
  let cookie: (wallet: string) => Promise<string>;
  let server: Server;
  let base = "";
  const realFetch = globalThis.fetch;
  const outgoing: { chat_id: string; text: string }[] = [];

  const sent: { chatId: string | number; text: string }[] = [];
  const fakeApi = {
    getMe: async () => ({ username: "solvers_bot" }),
    getUpdates: async () => [],
    sendMessage: async (chatId: string | number, text: string) => void sent.push({ chatId, text }),
    deleteWebhook: async () => undefined,
  };

  const W = (n: string) => `${P}-wallet-${n}`;
  const ID = (n: string) => `${P}-creator-${n}`;
  const call = async (wallet: string | null, path = "/api/creator/telegram-link", method = "POST") =>
    fetch(`${base}${path}`, { method, headers: wallet ? { cookie: await cookie(wallet) } : {} });
  const row = async (n: string) => (await db.select().from(schema.creators).where(eq(schema.creators.id, ID(n))))[0]!;
  const dm = (chat: number, text: string, id = 1) => ({ update_id: id, message: { message_id: id, text, chat: { id: chat, type: "private" } } });
  const deps = () => ({ api: fakeApi, redeem: store.redeemLinkCode, botUsername: "solvers_bot", limiter: rules.createFailureLimiter(), log: () => undefined });
  const link = async (wallet: string) => ((await (await call(wallet)).json()) as { code: string }).code;

  async function addCreator(n: string, name = `Criador ${n}`) {
    await db.insert(schema.creators).values({ id: ID(n), wallet: W(n), name, invited: true, termsAcceptedAt: new Date() });
  }
  async function cleanup() {
    await db.delete(schema.agents).where(like(schema.agents.slug, `${P}%`));
    await db.delete(schema.creators).where(like(schema.creators.id, `${P}%`));
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
      TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
      TELEGRAM_ADMIN_CHAT_ID: ADMIN_CHAT,
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    ({ eq, like } = await import("drizzle-orm"));
    rules = await import("../src/telegram/link-rules.js");
    store = await import("../src/telegram/link-store.js");
    poller = await import("../src/telegram/poller.js");
    notify = await import("../src/submissions/notify.js");
    tg = await import("../src/notify/telegram.js");
    const { setTelegramApiForTests } = await import("../src/telegram/client.js");
    setTelegramApiForTests(fakeApi);
    const { createApp } = await import("../src/app.js");
    const { creatorRouter } = await import("../src/creator/routes.js");
    const { signSession, SESSION_COOKIE } = await import("../src/auth/jwt.js");
    cookie = async (wallet) => `${SESSION_COOKIE}=${await signSession(wallet)}`;
    await cleanup();
    for (const n of ["a", "b", "limit", "swap", "race", "exp", "notify", "plain"]) await addCreator(n, n === "a" ? "Ana Souza" : `Criador ${n}`);
    await new Promise<void>((resolve) => {
      server = createApp([(app) => app.use("/api", creatorRouter)]).listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    // O Telegram nunca é chamado de verdade: o aviso (sendTelegram) cai neste fetch, as chamadas locais passam direto.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).startsWith("https://api.telegram.org/")) {
        outgoing.push(JSON.parse(String(init?.body)) as { chat_id: string; text: string });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    const { setTelegramApiForTests } = await import("../src/telegram/client.js");
    setTelegramApiForTests(undefined);
    if (!db) return;
    await cleanup();
    await pool.end();
  });

  it("sem perfil de criador: 403 profile_required, e nada é gravado", async () => {
    const res = await call(W("sem-perfil"));
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code: string }).code, "profile_required");
    assert.equal((await db.select().from(schema.creators).where(eq(schema.creators.wallet, W("sem-perfil")))).length, 0);
  });

  it("gera o código: formato, validade de 15 min, bot e deep link; só o hash fica no banco", async () => {
    const before = Date.now();
    const res = await call(W("a"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { code: string; expiresAt: string; botUsername: string; deepLink: string };
    assert.match(body.code, /^LINK-[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(body.botUsername, "solvers_bot");
    assert.equal(body.deepLink, `https://t.me/solvers_bot?start=${body.code}`);
    const left = new Date(body.expiresAt).getTime() - before;
    assert.ok(left > 14 * 60_000 && left <= 15 * 60_000 + 5000, `validade ${left} ms`);
    const c = await row("a");
    assert.equal(c.telegramLinkHash, rules.hashLinkCode(body.code));
    assert.deepEqual(c.telegramLinkExpiresAt, new Date(body.expiresAt));
    assert.equal(c.telegramChatId, null, "gerar o código não vincula nada");
    for (const v of Object.values(c)) assert.ok(typeof v !== "string" || !v.includes(body.code.slice(5)), "o código em si não é guardado");
    assert.ok(!JSON.stringify(body).includes(FAKE_TOKEN), "a resposta não traz o token");
  });

  it("sem login: 401", async () => {
    assert.equal((await call(null)).status, 401);
  });

  it("limite: 5 códigos por hora por criador, o 6º dá 429 e outro criador não é afetado", async () => {
    for (let i = 1; i <= 5; i++) assert.equal((await call(W("limit"))).status, 200, `código ${i}`);
    const sixth = await call(W("limit"));
    assert.equal(sixth.status, 429);
    const body = (await sixth.json()) as { code: string; retryAfterSec: number };
    assert.equal(body.code, "too_many_codes");
    assert.ok(body.retryAfterSec > 3000 && body.retryAfterSec <= 3600);
    assert.equal((await row("limit")).telegramLinkCount, 5, "o código recusado não gasta cota");
    assert.equal((await call(W("b"))).status, 200);
  });

  it("depois de uma hora a janela zera (relógio injetado)", async () => {
    const t = new Date(Date.now() + 61 * 60_000);
    const r = await store.issueLinkCode(W("limit"), t);
    assert.equal(r.status, "ok");
    assert.equal((await row("limit")).telegramLinkCount, 1);
  });

  it("um código novo cancela o anterior", async () => {
    const first = await link(W("swap"));
    const second = await link(W("swap"));
    assert.notEqual(first, second);
    assert.deepEqual(await store.redeemLinkCode("9001", first), { status: "invalid" });
    assert.deepEqual(await store.redeemLinkCode("9001", second), { status: "linked", name: "Criador swap" });
  });

  it("o bot recebe /vincular: grava o chat, apaga o código, responde com o nome e o site passa a ver o contato verificado", async () => {
    const me0 = (await (await call(W("a"), "/api/creator/me", "GET")).json()) as { contactVerified: boolean; telegramBot: { username: string } | null };
    assert.equal(me0.contactVerified, false);
    assert.deepEqual(me0.telegramBot, { username: "solvers_bot" });

    const code = await link(W("a"));
    sent.length = 0;
    // Digitado em minúsculas e sem o prefixo: o bot entende.
    const out = await poller.processUpdate(dm(5551, `/vincular ${code.slice(5).toLowerCase()}`), deps());
    assert.equal(out, "replied");
    assert.deepEqual(sent, [{ chatId: "5551", text: "Pronto! Seu Telegram foi vinculado ao Solvers como Ana Souza." }]);
    const c = await row("a");
    assert.equal(c.telegramChatId, "5551");
    assert.equal(c.telegramLinkHash, null);
    assert.equal(c.telegramLinkExpiresAt, null);
    const me = (await (await call(W("a"), "/api/creator/me", "GET")).json()) as { contactVerified: boolean };
    assert.equal(me.contactVerified, true);
  });

  it("uso único: o mesmo código não vincula de novo; código errado não revela nada", async () => {
    const code = await link(W("b"));
    sent.length = 0;
    await poller.processUpdate(dm(5552, `/start ${code}`), deps());
    assert.match(sent[0]!.text, /^Pronto! .* como Criador b\.$/);
    await poller.processUpdate(dm(5553, `/vincular ${code}`), deps());
    await poller.processUpdate(dm(5553, "/vincular LINK-ZZZZ2222"), deps());
    assert.equal(sent[1]!.text, rules.replyText({ kind: "invalid" }));
    assert.equal(sent[2]!.text, sent[1]!.text, "usado e inexistente respondem igual");
    assert.equal((await row("b")).telegramChatId, "5552", "o 2º chat não tomou o lugar do 1º");
  });

  it("código vencido: recusado e o chat não é gravado", async () => {
    const code = await link(W("exp"));
    await db.update(schema.creators).set({ telegramLinkExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.creators.id, ID("exp")));
    assert.deepEqual(await store.redeemLinkCode("5560", code), { status: "invalid" });
    assert.equal((await row("exp")).telegramChatId, null);
  });

  it("um chat só pode ficar em UM criador: o segundo é recusado e o código dele continua valendo", async () => {
    const code = await link(W("plain"));
    sent.length = 0;
    await poller.processUpdate(dm(5551, `/vincular ${code}`), deps()); // 5551 já é da Ana
    assert.equal(sent[0]!.text, rules.replyText({ kind: "chat_taken" }));
    const c = await row("plain");
    assert.equal(c.telegramChatId, null);
    assert.ok(c.telegramLinkHash, "o código não foi gasto");
    // Outra conta do Telegram resolve com o mesmo código.
    assert.deepEqual(await store.redeemLinkCode("5570", code), { status: "linked", name: "Criador plain" });
  });

  it("o mesmo criador pode revincular do mesmo chat ou de outro (troca de conta)", async () => {
    const again = await link(W("a"));
    assert.deepEqual(await store.redeemLinkCode("5551", again), { status: "linked", name: "Ana Souza" });
    const other = await link(W("a"));
    assert.deepEqual(await store.redeemLinkCode("5599", other), { status: "linked", name: "Ana Souza" });
    assert.equal((await row("a")).telegramChatId, "5599");
  });

  it("o mesmo código em dois chats ao mesmo tempo vale uma vez só", async () => {
    const code = await link(W("race"));
    const results = await Promise.all(["6001", "6002", "6003", "6004"].map((chat) => store.redeemLinkCode(chat, code)));
    assert.equal(results.filter((r) => r.status === "linked").length, 1);
    assert.equal(results.filter((r) => r.status === "invalid").length, 3);
    assert.ok(["6001", "6002", "6003", "6004"].includes((await row("race")).telegramChatId!));
  });

  it("avisos: o criador vinculado recebe no chat dele; sem vínculo o chamado cai no chat do admin", async () => {
    await db.insert(schema.agents).values({
      id: AGENT, slug: `${P}-agente`, name: "Agente de teste", tagline: "t", description: "d", category: "Outros",
      creatorId: ID("notify"), version: "1.0.0", versionHash: "ab".repeat(32), price: 5_000_000n, status: "active", listed: true,
    });
    outgoing.length = 0;
    // Ainda sem Telegram vinculado: nada para o criador (revisão) e o chamado do comprador vai ao admin.
    await notify.notifyCreatorWallet(W("notify"), "revisão 1");
    await tg.notifyCreator(AGENT, "chamado 1");
    assert.deepEqual(outgoing.map((o) => [String(o.chat_id), o.text]), [[ADMIN_CHAT, "chamado 1"]]);

    // O criador vincula depois: as próximas mensagens vão para ele.
    const code = await link(W("notify"));
    assert.equal((await store.redeemLinkCode("8123", code)).status, "linked");
    outgoing.length = 0;
    await notify.notifyCreatorWallet(W("notify"), "revisão 2");
    await tg.notifyCreator(AGENT, "chamado 2");
    assert.deepEqual(outgoing.map((o) => [String(o.chat_id), o.text]), [["8123", "revisão 2"], ["8123", "chamado 2"]]);
  });
});

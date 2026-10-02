import { strict as assert } from "node:assert";
import { createCipheriv, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

// Memória do especialista contra um Postgres real (PACKAGE_SPEC.md 11): chamadas paralelas não perdem dados,
// formato antigo continua legível, limite estourado desfaz tudo. Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL
// já migrado; veja o cabeçalho de platform-status.db.test.ts).

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "memtest";
const AGENT = "0".repeat(24) + "me000001";
const KEY = Buffer.alloc(32, 9);

describe("memória com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let like: typeof import("drizzle-orm").like;
  let mem: typeof import("../src/memory/crypto.js");
  let HttpError: typeof import("../src/lib/http.js").HttpError;
  let n = 0;
  const wallet = () => `${PREFIX}-w${++n}-${randomBytes(3).toString("hex")}`;

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
    ({ like } = await import("drizzle-orm"));
    mem = await import("../src/memory/crypto.js");
    ({ HttpError } = await import("../src/lib/http.js"));
    await db.delete(schema.memories).where(like(schema.memories.wallet, `${PREFIX}%`));
  });

  after(async () => {
    if (!db) return;
    await db.delete(schema.memories).where(like(schema.memories.wallet, `${PREFIX}%`));
    await pool.end();
  });

  it("chamadas paralelas na PRIMEIRA gravação não perdem nada (summary + profile + 10 notas)", async () => {
    const w = wallet();
    await Promise.all([
      mem.saveMemory(w, AGENT, KEY, { kind: "summary", content: "Prefere TypeScript" }),
      mem.saveMemory(w, AGENT, KEY, { kind: "profile", content: '{"perfil":"Equilibrado"}' }),
      ...Array.from({ length: 10 }, (_, i) => mem.saveMemory(w, AGENT, KEY, { kind: "note", content: `nota número ${i}` })),
    ]);
    const [m] = await mem.readMemories(w, KEY, AGENT);
    assert.equal(m!.summary, "Prefere TypeScript");
    assert.deepEqual(m!.profile, { perfil: "Equilibrado" });
    assert.equal(m!.notes.length, 10);
    assert.equal(new Set(m!.notes.map((x) => x.id)).size, 10);
    // Uma única linha por carteira + especialista.
    assert.equal((await db.select().from(schema.memories).where(like(schema.memories.wallet, w))).length, 1);
  });

  it("summary novo não apaga perfil nem notas (antes regravava só { summary })", async () => {
    const w = wallet();
    await mem.saveMemory(w, AGENT, KEY, { kind: "profile", content: '{"a":"1"}' });
    await mem.saveMemory(w, AGENT, KEY, { kind: "note", content: "uma nota" });
    await mem.saveMemory(w, AGENT, KEY, { kind: "summary", content: "resumo completo novo" });
    const [m] = await mem.readMemories(w, KEY, AGENT);
    assert.equal(m!.summary, "resumo completo novo");
    assert.deepEqual(m!.profile, { a: "1" });
    assert.equal(m!.notes.length, 1);
  });

  it("forget remove só a nota pedida, em paralelo com novas notas", async () => {
    const w = wallet();
    const a = await mem.saveMemory(w, AGENT, KEY, { kind: "note", content: "apagar esta" });
    const b = await mem.saveMemory(w, AGENT, KEY, { kind: "note", content: "manter esta" });
    const [found] = await Promise.all([
      mem.forgetNote(w, AGENT, KEY, a!.note!.id),
      mem.saveMemory(w, AGENT, KEY, { kind: "note", content: "nota nova em paralelo" }),
    ]);
    assert.equal(found, true);
    const [m] = await mem.readMemories(w, KEY, AGENT);
    assert.deepEqual(m!.notes.map((x) => x.text).sort(), ["manter esta", "nota nova em paralelo"]);
    assert.ok(m!.notes.some((x) => x.id === b!.note!.id));
    assert.equal(await mem.forgetNote(w, AGENT, KEY, "n_naoexiste"), false);
  });

  it("forget sem memória nenhuma: null e não cria linha", async () => {
    const w = wallet();
    assert.equal(await mem.forgetNote(w, AGENT, KEY, "n_x"), null);
    assert.equal((await db.select().from(schema.memories).where(like(schema.memories.wallet, w))).length, 0);
  });

  it("limite estourado na primeira gravação: erro 400 e nenhuma linha fica para trás", async () => {
    const w = wallet();
    await assert.rejects(
      mem.saveMemory(w, AGENT, KEY, { kind: "summary", content: "x".repeat(4001) }),
      (e: unknown) => e instanceof HttpError && e.status === 400,
    );
    assert.equal((await db.select().from(schema.memories).where(like(schema.memories.wallet, w))).length, 0);
  });

  it("31ª nota recusada e as 30 anteriores continuam", async () => {
    const w = wallet();
    for (let i = 0; i < 30; i++) await mem.saveMemory(w, AGENT, KEY, { kind: "note", content: `nota ${i}` });
    await assert.rejects(mem.saveMemory(w, AGENT, KEY, { kind: "note", content: "a de número 31" }), (e: unknown) => e instanceof HttpError && e.status === 400);
    const [m] = await mem.readMemories(w, KEY, AGENT);
    assert.equal(m!.notes.length, 30);
  });

  it("formato antigo ({ summary }) é lido sem migração e aceita perfil e notas por cima", async () => {
    const w = wallet();
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", KEY, iv);
    c.setAAD(Buffer.from(`${w}|${AGENT}`));
    const ciphertext = Buffer.concat([c.update(Buffer.from(JSON.stringify({ summary: "texto antigo" }))), c.final()]);
    await db.insert(schema.memories).values({ id: `mem_${randomBytes(5).toString("hex")}`, wallet: w, agentId: AGENT, ciphertext, iv, tag: c.getAuthTag() });
    const [old] = await mem.readMemories(w, KEY, AGENT);
    assert.equal(old!.summary, "texto antigo");
    assert.equal(old!.profile, null);
    assert.deepEqual(old!.notes, []);
    await mem.saveMemory(w, AGENT, KEY, { kind: "note", content: "agora com nota" });
    const [now] = await mem.readMemories(w, KEY, AGENT);
    assert.equal(now!.summary, "texto antigo");
    assert.equal(now!.notes.length, 1);
  });

  it("memória só com perfil: summary vazio (nunca undefined)", async () => {
    const w = wallet();
    await mem.saveMemory(w, AGENT, KEY, { kind: "profile", content: '{"skipped":true}' });
    const [m] = await mem.readMemories(w, KEY, AGENT);
    assert.equal(m!.summary, "");
    assert.deepEqual(m!.profile, { skipped: true });
  });

  it("chave diferente não sobrescreve a memória existente (409)", async () => {
    const w = wallet();
    await mem.saveMemory(w, AGENT, KEY, { kind: "summary", content: "segredo do usuário" });
    await assert.rejects(
      mem.saveMemory(w, AGENT, Buffer.alloc(32, 1), { kind: "summary", content: "outra chave" }),
      (e: unknown) => e instanceof HttpError && e.status === 409,
    );
    assert.equal((await mem.readMemories(w, KEY, AGENT))[0]!.summary, "segredo do usuário");
  });
});

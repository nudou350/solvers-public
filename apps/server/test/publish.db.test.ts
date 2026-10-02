import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { FakeChain } from "./helpers/fake-publish-chain.js";

// Publicação on-chain com banco real e blockchain SIMULADA (PACKAGE_SPEC.md 15): co-assinatura do criador pelas rotas HTTP,
// aprovação do admin, finalização (idempotente, falha e retomada), versão aprovada x cadeia (sync_flag, price_in_review) e
// kill switch. Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja platform-status.db.test.ts.
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (prefixo "pubtest").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "pubtest";
const hexId = (suffix: string) => "0".repeat(24) + suffix;
const AGENT_A = hexId("b2b2a001"); // Solver novo -> atualizações -> suspensão
const AGENT_B = hexId("b2b2a002"); // Solver novo finalizado só pelo evento da cadeia
const AGENT_C = hexId("b2b2a003"); // espelho do indexador (sync_flag)
const AGENT_IDS = [AGENT_A, AGENT_B, AGENT_C];
const CREATOR = `${PREFIX}-creator-wallet`;
const OTHER = `${PREFIX}-other-wallet`;
const ADMIN_SITE = `${PREFIX}-admin-wallet`;
const H = (c: string) => c.repeat(64);

describe("publicação com banco e cadeia simulada", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let d: typeof import("drizzle-orm");
  let server: Server;
  let base = "";
  let cookie: (wallet: string) => Promise<string>;
  let fake: FakeChain;
  let packageHash: typeof import("../src/runtime/packages.js").packageHash;
  let finalizePublication: typeof import("../src/publish/finalize.js").finalizePublication;
  let approveOnChain: typeof import("../src/publish/approve.js").approveOnChain;
  let ApproveError: typeof import("../src/publish/approve.js").ApproveError;
  let suspendSolver: typeof import("../src/publish/suspend.js").suspendSolver;
  let SuspendError: typeof import("../src/publish/suspend.js").SuspendError;
  let onPublishEvent: typeof import("../src/publish/reconcile.js").onPublishEvent;
  let mirrorAgentAccount: typeof import("../src/indexer/sync.js").mirrorAgentAccount;
  let loadApprovedVersions: typeof import("../src/indexer/sync.js").loadApprovedVersions;
  let assertFreshPrice: typeof import("../src/store/fresh-price.js").assertFreshPrice;
  let getSession: typeof import("../src/runtime/engine.js").getSession;
  let publishedVersionOf: typeof import("../src/publish/fs.js").publishedVersionOf;
  const root = mkdtempSync(join(tmpdir(), "solvers-publish-"));
  const SUBS = join(root, "submissions");
  const PUBLISHED = join(root, "packages");

  // ---------- fixtures ----------

  /** Pasta extraída de uma submissão (SUBMISSIONS_DIR/<id>/extracted/<slug>), no formato que o B1 deixa. */
  function writePackage(subId: string, slug: string, agentId: string, version: string, priceUsdc: number) {
    const dir = join(SUBS, subId, "extracted", slug);
    mkdirSync(join(dir, "steps"), { recursive: true });
    mkdirSync(join(dir, "knowledge"), { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id: agentId,
        slug,
        name: "Solver de Teste",
        tagline: "Uma frase de valor",
        description: `Descrição da versão ${version}`,
        category: "Outros",
        version,
        creator: { id: `${PREFIX}-creator`, name: "Criador de teste", bio: "Bio" },
        requirements: [],
        packageContents: ["a"],
        steps: [{ file: "steps/01-primeira.md", gate: [] }],
        pricing: { priceUsdc, royaltyBps: 500 },
        guarantee: { available: false, defaultCriteria: [] },
      }),
    );
    writeFileSync(join(dir, "steps", "01-primeira.md"), `# Etapa 1\n\nFaça o que for preciso na ${version}.`);
    writeFileSync(join(dir, "knowledge", "a.md"), `Conhecimento da versão ${version}.`);
    return dir;
  }

  /** Submissão aprovada pelo site (o que o B1 deixa): registro aprovado, linha de versão aprovada e conhecimento em staging. */
  async function seed(subId: string, agentId: string, slug: string, version: string, priceUsdc: number, status = "awaiting_creator_signature") {
    const dir = writePackage(subId, slug, agentId, version, priceUsdc);
    const versionHash = packageHash(dir);
    const priceUnits = BigInt(priceUsdc) * 1_000_000n;
    await db.insert(schema.packageSubmissions).values({
      id: subId,
      creatorWallet: CREATOR,
      agentId,
      slug,
      version,
      status,
      approved: { versionHash, priceUsdc: priceUnits.toString(), royaltyBps: 500, name: "Solver de Teste", version },
    });
    await db.insert(schema.agentPublishedVersions).values({ agentId, version, versionHash, priceUsdc: priceUnits }).onConflictDoNothing();
    await db.insert(schema.knowledgeChunks).values({ agentId, version: `staging:${subId}`, source: "knowledge/a.md", content: `Conhecimento da versão ${version}.` });
    return { dir, versionHash, approved: { versionHash, priceUsdc: priceUnits.toString(), royaltyBps: 500, name: "Solver de Teste", version } };
  }

  const sub = async (id: string) => (await db.select().from(schema.packageSubmissions).where(d.eq(schema.packageSubmissions.id, id)))[0]!;
  const agent = async (id: string) => (await db.select().from(schema.agents).where(d.eq(schema.agents.id, id)))[0]!;
  const reviews = async (submissionId: string, action?: string) =>
    (await db.select().from(schema.packageReviews).where(d.eq(schema.packageReviews.submissionId, submissionId))).filter((r) => !action || r.action === action);
  const chunkVersions = async (agentId: string) =>
    [...new Set((await db.select({ v: schema.knowledgeChunks.version }).from(schema.knowledgeChunks).where(d.eq(schema.knowledgeChunks.agentId, agentId))).map((r) => r.v))].sort();

  // /api/tx tem limite de 20 por minuto por IP (app.ts): cada chamada do teste vem de um "IP" diferente (trust proxy 1).
  let fakeIp = 0;
  async function http(wallet: string | null, method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(++fakeIp / 250)}.${(fakeIp % 250) + 1}`, ...(wallet ? { cookie: await cookie(wallet) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const tx = (wallet: string | null, kind: string, submissionId: string, extra: Record<string, unknown> = {}) => http(wallet, "POST", `/tx/${kind}`, { submissionId, ...extra });

  async function cleanup() {
    // package_reviews é somente-inserção (trigger): o banco é DESCARTÁVEL, então só aqui o gatilho é desligado.
    await db.execute(d.sql`alter table package_reviews disable trigger package_reviews_no_update_delete`);
    await db.delete(schema.packageReviews).where(d.like(schema.packageReviews.submissionId, `${PREFIX}%`));
    await db.delete(schema.packageReviews).where(d.inArray(schema.packageReviews.submissionId, AGENT_IDS.map((id) => `agent:${id}`)));
    await db.execute(d.sql`alter table package_reviews enable trigger package_reviews_no_update_delete`);
    await db.delete(schema.packageSubmissions).where(d.like(schema.packageSubmissions.id, `${PREFIX}%`));
    await db.delete(schema.agentPublishedVersions).where(d.inArray(schema.agentPublishedVersions.agentId, AGENT_IDS));
    await db.delete(schema.knowledgeChunks).where(d.inArray(schema.knowledgeChunks.agentId, AGENT_IDS));
    await db.delete(schema.agentSearchVectors).where(d.inArray(schema.agentSearchVectors.agentId, AGENT_IDS));
    await db.delete(schema.sessions).where(d.like(schema.sessions.id, `${PREFIX}%`));
    await db.delete(schema.agents).where(d.inArray(schema.agents.id, AGENT_IDS));
    await db.delete(schema.creators).where(d.like(schema.creators.id, `${PREFIX}%`));
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
      SEARCH_MODE: "fts", // sem modelo de embeddings: o catálogo grava só o texto de busca
      SUBMISSIONS_DIR: SUBS,
      PUBLISHED_DIR: PUBLISHED,
      ADMIN_WALLETS: ADMIN_SITE,
      TELEGRAM_BOT_TOKEN: "",
    });
    delete process.env.TELEGRAM_BOT_TOKEN;
    ({ db, schema, pool } = await import("../src/db/index.js"));
    d = await import("drizzle-orm");
    ({ packageHash } = await import("../src/runtime/packages.js"));
    ({ finalizePublication } = await import("../src/publish/finalize.js"));
    ({ approveOnChain, ApproveError } = await import("../src/publish/approve.js"));
    ({ suspendSolver, SuspendError } = await import("../src/publish/suspend.js"));
    ({ onPublishEvent } = await import("../src/publish/reconcile.js"));
    ({ mirrorAgentAccount, loadApprovedVersions } = await import("../src/indexer/sync.js"));
    ({ assertFreshPrice } = await import("../src/store/fresh-price.js"));
    ({ getSession } = await import("../src/runtime/engine.js"));
    ({ publishedVersionOf } = await import("../src/publish/fs.js"));
    const { FakeChain: FC } = await import("./helpers/fake-publish-chain.js");
    fake = new FC((addr, acc) => mirrorAgentAccount(addr as never, acc));
    (await import("../src/publish/chain-port.js")).setPublishChain(fake);
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");
    const { signSession, SESSION_COOKIE } = await import("../src/auth/jwt.js");
    cookie = async (wallet) => `${SESSION_COOKIE}=${await signSession(wallet)}`;

    await cleanup();
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: CREATOR, name: "Criador de teste", invited: true });
    await new Promise<void>((resolve) => {
      server = createApp(mounts).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    server?.close();
    (await import("../src/publish/chain-port.js")).setPublishChain(null);
    rmSync(root, { recursive: true, force: true });
    if (!db) return;
    await cleanup();
    await pool.end();
  });

  // ---------- Solver novo: co-assinatura -> aprovação do admin -> no ar ----------

  describe("Solver novo", () => {
    const N1 = `${PREFIX}-n1`;
    const SLUG = `${PREFIX}-novo`;
    let approved: { versionHash: string; priceUsdc: string; royaltyBps: number; name: string; version: string };
    let registerSig = "";

    before(async () => {
      ({ approved } = await seed(N1, AGENT_A, SLUG, "1.0.0", 10));
    });

    it("sem login 401; carteira de outro criador 403; submissão inexistente 404", async () => {
      assert.equal((await tx(null, "register-agent", N1)).status, 401);
      const other = await tx(OTHER, "register-agent", N1);
      assert.equal(other.status, 403);
      assert.equal((await tx(CREATOR, "register-agent", `${PREFIX}-nao-existe`)).status, 404);
      assert.equal((await tx(CREATOR, "register-agent", "")).status, 400);
    });

    it("o passo errado dá 409 wrong_step com o esperado (o cliente não escolhe o passo)", async () => {
      const r = await tx(CREATOR, "update-version", N1);
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "wrong_step");
      assert.equal(r.body.expected, "register-agent");
      assert.equal((await tx(CREATOR, "update-pricing", N1)).body.expected, "register-agent");
    });

    it("submissão fora de awaiting_creator_signature não monta transação (409 submission_state)", async () => {
      await seed(`${PREFIX}-pend`, AGENT_C, `${PREFIX}-pendente`, "1.0.0", 10, "pending_review");
      const r = await tx(CREATOR, "register-agent", `${PREFIX}-pend`);
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "submission_state");
      assert.equal(r.body.status, "pending_review");
      await db.delete(schema.agentPublishedVersions).where(d.eq(schema.agentPublishedVersions.agentId, AGENT_C));
    });

    it("saldo menor que o depósito: 400 insufficient_funds, com os valores", async () => {
      fake.balances.set(CREATOR, 1_000_000n);
      const r = await tx(CREATOR, "register-agent", N1);
      assert.equal(r.status, 400);
      assert.equal(r.body.code, "insufficient_funds");
      assert.equal(r.body.neededUsdc, 5);
      assert.equal(r.body.balanceUsdc, 1);
      fake.balances.delete(CREATOR);
    });

    it("register-agent: monta com preço, hash, nome e versão do REGISTRO APROVADO, mesmo que o cliente mande outros", async () => {
      const r = await tx(CREATOR, "register-agent", N1, { priceUsdc: 1, versionHash: H("f"), name: "Outro nome", version: "9.9.9" });
      assert.equal(r.status, 200);
      assert.equal(r.body.transaction, "FAKE-register");
      assert.equal(typeof r.body.blockhash, "string");
      assert.equal(typeof r.body.lastValidBlockHeight, "number");
      const meta = r.body.meta as Record<string, unknown>;
      assert.equal(meta.kind, "register-agent");
      assert.equal(meta.submission_id, N1);
      assert.equal(meta.submissionId, N1);
      const built = fake.built.at(-1)!;
      assert.equal(built.wallet, CREATOR);
      assert.deepEqual(built.approved, approved);
    });

    it("o criador assina e a transação entra (o /tx/submit indexa): ainda é um agente sem catálogo, aprovado (sync ok)", async () => {
      registerSig = fake.land("register-agent", CREATOR, AGENT_A, approved);
      await fake.indexSignature(registerSig);
      const a = await agent(AGENT_A);
      assert.equal(a.syncFlag, "ok", "a versão aprovada foi gravada ANTES da transação, então o indexador a aceita");
      assert.equal(a.listed, false);
      assert.equal(a.slug, AGENT_A, "linha mínima do indexador: o catálogo só é gravado no último passo");
    });

    it("confirm: assinatura que não é deste Solver 400; a certa liga register_tx e avança para awaiting_onchain_approval", async () => {
      const bad = await http(CREATOR, "POST", "/tx/publication/confirm", { submissionId: N1, signature: "x".repeat(70) });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.code, "signature_not_for_agent");
      const outsider = await http(OTHER, "POST", "/tx/publication/confirm", { submissionId: N1, signature: registerSig });
      assert.equal(outsider.status, 403);

      const ok = await http(CREATOR, "POST", "/tx/publication/confirm", { submissionId: N1, signature: registerSig, kind: "register-agent" });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.outcome, "not_ready");
      assert.equal(ok.body.step, "await-admin-approval");
      assert.equal(ok.body.status, "awaiting_onchain_approval");
      const s = await sub(N1);
      assert.equal(s.registerTx, registerSig);
      // A vitrine NÃO mudou: nada de pasta publicada nem catálogo.
      assert.equal(existsSync(join(PUBLISHED, SLUG)), false);
      assert.equal((await agent(AGENT_A)).name, "Solver sem catálogo");
    });

    it("o plano diz o que falta (lido da cadeia)", async () => {
      const r = await http(CREATOR, "GET", `/tx/publication/${N1}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.step, "await-admin-approval");
      assert.equal(r.body.isNewAgent, true);
      assert.equal((r.body.approved as { priceUsdc: number }).priceUsdc, 10);
      assert.equal((r.body.chain as { registered: boolean }).registered, true);
      assert.equal((await http(OTHER, "GET", `/tx/publication/${N1}`)).status, 403);
    });

    it("cli:approve recusa chave que não é o admin on-chain e o dry-run não envia nada", async () => {
      fake.onchainAdminAddress = "OutroAdmin";
      await assert.rejects(approveOnChain(SLUG, { port: fake }), (e: unknown) => e instanceof ApproveError && /não é o admin on-chain/.test((e as Error).message));
      fake.onchainAdminAddress = "AdminOnchainWallet";
      const dry = await approveOnChain(SLUG, { port: fake, dryRun: true });
      assert.equal(dry.approveTx, null);
      assert.equal(dry.step, "await-admin-approval");
      assert.deepEqual(fake.calls, []);
    });

    it("cli:approve recusa quando a cadeia NÃO bate com a versão aprovada (não assina o que a revisão não viu)", async () => {
      const tampered = fake.tamper(AGENT_A, { versionHash: H("e") });
      await fake.indexSignature(tampered);
      await assert.rejects(approveOnChain(N1, { port: fake }), (e: unknown) => e instanceof ApproveError && /falta: update-version/.test((e as Error).message));
      assert.deepEqual(fake.calls, []);
      fake.tamper(AGENT_A, { versionHash: approved.versionHash });
    });

    it("cli:approve assina o approve_agent, grava approve_tx e finaliza: o Solver vai ao ar", async () => {
      let reloads = 0;
      const r = await approveOnChain(SLUG, { port: fake, deps: { reload: () => void reloads++ } });
      assert.ok(r.approveTx);
      assert.deepEqual(r.finalize, { outcome: "published", version: "1.0.0" });
      assert.deepEqual(fake.calls, [`approve:${AGENT_A}`]);
      assert.equal(reloads, 1, "reloadPackages() chamado");

      const s = await sub(N1);
      assert.equal(s.status, "published");
      assert.equal(s.approveTx, r.approveTx);
      const [pv] = await db.select().from(schema.agentPublishedVersions).where(d.and(d.eq(schema.agentPublishedVersions.agentId, AGENT_A), d.eq(schema.agentPublishedVersions.version, "1.0.0")));
      assert.equal(pv!.approveTx, r.approveTx);

      const a = await agent(AGENT_A);
      assert.equal(a.slug, SLUG);
      assert.equal(a.name, "Solver de Teste");
      assert.equal(a.version, "1.0.0");
      assert.equal(a.versionHash, approved.versionHash);
      assert.equal(a.price, 10_000_000n);
      assert.equal(a.status, "active");
      assert.equal(a.platformStatus, "active");
      assert.equal(a.syncFlag, "ok");
      assert.equal(a.listed, true);
      assert.equal(a.creatorId, `${PREFIX}-creator`);
      assert.match(a.searchText, /Solver de Teste/);

      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.0.0");
      assert.equal(existsSync(join(PUBLISHED, ".incoming", N1)), false, "pasta de preparo limpa");
      assert.deepEqual(await chunkVersions(AGENT_A), ["1.0.0"], "os trechos de staging viraram os da versão real");
      const fin = await reviews(N1, "finish");
      assert.equal(fin.length, 1);
      assert.equal(fin[0]!.reviewerWallet, "AdminOnchainWallet");
    });

    it("idempotente: finalizar de novo não muda nada; o botão 'Concluir' é só do admin do site", async () => {
      assert.deepEqual(await finalizePublication(N1), { outcome: "already_published" });
      assert.equal((await http(CREATOR, "POST", `/admin/submissions/${N1}/finish`)).status, 403);
      assert.equal((await http(null, "POST", `/admin/submissions/${N1}/finish`)).status, 401);
      assert.equal((await http(ADMIN_SITE, "POST", `/admin/submissions/${PREFIX}-nao-existe/finish`)).status, 404);
      const again = await http(ADMIN_SITE, "POST", `/admin/submissions/${N1}/finish`);
      assert.equal(again.status, 200);
      assert.equal(again.body.outcome, "already_published");
      assert.equal(again.body.status, "published");
      assert.equal((await reviews(N1, "finish")).length, 1);
      await assert.rejects(approveOnChain(N1, { port: fake }), ApproveError);
    });
  });

  // ---------- Atualização de Solver aprovado ----------

  describe("Atualização", () => {
    const N1 = `${PREFIX}-n1`;
    const U2 = `${PREFIX}-u2`;
    const SLUG = `${PREFIX}-novo`;
    let approved: { versionHash: string; priceUsdc: string; royaltyBps: number; name: string; version: string };

    before(async () => {
      ({ approved } = await seed(U2, AGENT_A, SLUG, "1.1.0", 12));
    });

    it("o passo seguinte é update_version (não register nem preço)", async () => {
      assert.equal((await tx(CREATOR, "register-agent", U2)).body.expected, "update-version");
      assert.equal((await tx(CREATOR, "update-pricing", U2)).body.expected, "update-version");
      const r = await tx(CREATOR, "update-version", U2);
      assert.equal(r.status, 200);
      assert.equal((r.body.meta as Record<string, unknown>).kind, "update-version");
      assert.deepEqual(fake.built.at(-1)!.approved, approved);
    });

    it("entre update_version e update_pricing o preço da cadeia não é o aprovado: sync_flag levanta e a vitrine segue no aprovado", async () => {
      const sig = fake.land("update-version", CREATOR, AGENT_A, approved);
      await fake.indexSignature(sig);
      const a = await agent(AGENT_A);
      assert.equal(a.syncFlag, "unapproved_chain_version");
      assert.equal(a.version, "1.0.0", "versão da vitrine = a aprovada e publicada");
      assert.equal(a.price, 10_000_000n);
      const plan = await http(CREATOR, "GET", `/tx/publication/${U2}`);
      assert.equal(plan.body.step, "update-pricing");
      assert.equal(plan.body.isNewAgent, false);
    });

    it("a venda fica bloqueada (price_in_review) enquanto a cadeia diverge", async () => {
      const a = await agent(AGENT_A);
      const deps = {
        readChain: async (id: string) => {
          const s = await fake.fetchAgentState(id);
          return s.exists ? { address: s.address, version: s.version, versionHash: s.versionHash, price: s.price } : null;
        },
        approvedVersions: loadApprovedVersions,
        sync: async () => undefined,
      };
      await assert.rejects(assertFreshPrice(a, deps), (e: unknown) => (e as { status?: number; code?: string }).status === 409 && (e as { code?: string }).code === "price_in_review");
    });

    it("update_pricing: monta com o preço aprovado; ao entrar, a cadeia bate e o espelho volta a ok com a versão nova", async () => {
      const r = await tx(CREATOR, "update-pricing", U2);
      assert.equal(r.status, 200);
      assert.equal(fake.built.at(-1)!.kind, "update-pricing");
      assert.equal(fake.built.at(-1)!.approved.priceUsdc, "12000000");
      const sig = fake.land("update-pricing", CREATOR, AGENT_A, approved);
      await fake.indexSignature(sig);
      const a = await agent(AGENT_A);
      assert.equal(a.syncFlag, "ok");
      assert.equal(a.version, "1.1.0");
      assert.equal(a.price, 12_000_000n);
      // ...mas o pacote SERVIDO ainda é o antigo até a finalização.
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.0.0");
      assert.equal((await http(CREATOR, "GET", `/tx/publication/${U2}`)).body.step, "ready");
    });

    it("confirm: com tudo pronto (atualização não tem aprovação on-chain) publica na hora; a versão anterior vai para _archive e os trechos antigos saem", async () => {
      const sig = (await sub(U2)).registerTx;
      assert.equal(sig, null, "nada ligado ainda");
      const lastSig = [...fake.signatures.keys()].at(-1)!;
      const r = await http(CREATOR, "POST", "/tx/publication/confirm", { submissionId: U2, signature: lastSig, kind: "update-pricing" });
      assert.equal(r.status, 200);
      assert.equal(r.body.outcome, "published");
      assert.equal(r.body.status, "published");

      assert.equal((await sub(U2)).status, "published");
      assert.equal((await sub(U2)).registerTx, lastSig, "primeira assinatura confirmada vira register_tx");
      assert.equal((await sub(N1)).status, "superseded", "a versão anterior foi substituída");
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.1.0");
      assert.equal(publishedVersionOf(join(PUBLISHED, "_archive", SLUG, "1.0.0")), "1.0.0");
      assert.deepEqual(await chunkVersions(AGENT_A), ["1.1.0"]);
      const a = await agent(AGENT_A);
      assert.equal(a.version, "1.1.0");
      assert.equal(a.price, 12_000_000n);
      assert.equal(a.listed, true);
      assert.equal(readFileSync(join(PUBLISHED, SLUG, "knowledge", "a.md"), "utf8"), "Conhecimento da versão 1.1.0.");
      // Já publicada: pedir o passo de novo é 409 de estado.
      assert.equal((await tx(CREATOR, "update-pricing", U2)).body.code, "submission_state");
    });
  });

  // ---------- Falha e retomada ----------

  describe("Falha e retomada", () => {
    const U2 = `${PREFIX}-u2`;
    const SLUG = `${PREFIX}-novo`;

    it("update_pricing só existe quando o preço mudou: com o mesmo preço, depois do update_version o passo é 'ready'", async () => {
      const S3 = `${PREFIX}-s3`;
      const { approved, dir } = await seed(S3, AGENT_A, SLUG, "1.2.0", 12);
      assert.equal((await tx(CREATOR, "update-pricing", S3)).body.expected, "update-version");
      const sig = fake.land("update-version", CREATOR, AGENT_A, approved);
      await fake.indexSignature(sig);
      const r = await tx(CREATOR, "update-pricing", S3);
      assert.equal(r.status, 409);
      assert.equal(r.body.expected, "ready");

      // O conteúdo muda DEPOIS da aprovação: o hash não bate e a publicação falha sem tocar na pasta publicada.
      const original = readFileSync(join(dir, "knowledge", "a.md"), "utf8");
      writeFileSync(join(dir, "knowledge", "a.md"), `${original} ADULTERADO`);
      const c = await http(CREATOR, "POST", "/tx/publication/confirm", { submissionId: S3, signature: sig, kind: "update-version" });
      assert.equal(c.body.outcome, "failed");
      assert.equal(c.body.status, "publish_failed");
      assert.match(String(c.body.error), /mudou depois da aprovação/);
      const s = await sub(S3);
      assert.equal(s.status, "publish_failed");
      assert.match(s.error ?? "", /hash/);
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.1.0", "a pasta publicada não foi tocada");
      assert.equal((await sub(U2)).status, "published", "a versão no ar continua sendo a anterior");
      assert.deepEqual((await chunkVersions(AGENT_A)).includes(`staging:${S3}`), true, "conhecimento de staging intacto para a nova tentativa");

      // Só o admin do site retoma; enquanto o conteúdo estiver adulterado continua falhando.
      assert.equal((await http(CREATOR, "POST", `/admin/submissions/${S3}/finish`)).status, 403);
      const again = await http(ADMIN_SITE, "POST", `/admin/submissions/${S3}/finish`);
      assert.equal(again.body.outcome, "failed");
      assert.equal((await reviews(S3, "finish")).length, 0, "a trilha só registra a conclusão que deu certo");

      writeFileSync(join(dir, "knowledge", "a.md"), original);
      const fixed = await http(ADMIN_SITE, "POST", `/admin/submissions/${S3}/finish`);
      assert.equal(fixed.status, 200);
      assert.equal(fixed.body.outcome, "published");
      assert.equal((await sub(S3)).status, "published");
      assert.equal((await sub(S3)).error, null);
      assert.equal((await sub(U2)).status, "superseded");
      const fin = await reviews(S3, "finish");
      assert.equal(fin.length, 1);
      assert.equal(fin[0]!.reviewerWallet, ADMIN_SITE);
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.2.0");
    });

    it("falha no meio (depois do disco) e retomada: não arquiva duas vezes nem perde o conhecimento", async () => {
      const S4 = `${PREFIX}-s4`;
      const { approved } = await seed(S4, AGENT_A, SLUG, "1.3.0", 12);
      await fake.indexSignature(fake.land("update-version", CREATOR, AGENT_A, approved));
      let reloads = 0;
      const first = await finalizePublication(S4, {
        deps: { renameKnowledge: async () => Promise.reject(new Error("banco caiu")), reload: () => void reloads++ },
      });
      // Erro interno (banco): o criador vê texto fixo, o detalhe ("banco caiu") fica no log e no aviso do admin.
      assert.equal(first.outcome, "failed");
      assert.match(String((first as { error?: string }).error), /erro interno/);
      assert.doesNotMatch(String((first as { error?: string }).error), /banco caiu/);
      assert.equal((await sub(S4)).status, "publish_failed");
      assert.doesNotMatch((await sub(S4)).error ?? "", /banco caiu/);
      assert.equal(reloads, 0);
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.3.0", "o disco já tinha sido trocado");
      assert.equal(publishedVersionOf(join(PUBLISHED, "_archive", SLUG, "1.2.0")), "1.2.0");

      const retry = await finalizePublication(S4, { deps: { reload: () => void reloads++ } });
      assert.deepEqual(retry, { outcome: "published", version: "1.3.0" });
      assert.equal(reloads, 1);
      assert.equal(existsSync(join(PUBLISHED, "_archive", SLUG, "1.2.0-1")), false, "a retomada não arquiva a versão nova por cima da antiga");
      assert.deepEqual(await chunkVersions(AGENT_A), ["1.3.0"]);
      assert.equal((await sub(S4)).status, "published");
    });

    it("duas finalizações ao mesmo tempo (evento + botão + CLI): uma publica, a outra espera ou já encontra publicado", async () => {
      const S5 = `${PREFIX}-s5`;
      const { approved } = await seed(S5, AGENT_A, SLUG, "1.4.0", 12);
      await fake.indexSignature(fake.land("update-version", CREATOR, AGENT_A, approved));
      const results = await Promise.all([finalizePublication(S5), finalizePublication(S5), finalizePublication(S5)]);
      assert.equal(results.filter((r) => r.outcome === "published").length, 1, JSON.stringify(results));
      for (const r of results) assert.ok(["published", "busy", "already_published"].includes(r.outcome), JSON.stringify(r));
      assert.equal((await sub(S5)).status, "published");
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.4.0");
    });

    it("cadeia ainda atrás do aprovado: não finaliza e não muda nada", async () => {
      const S6 = `${PREFIX}-s6`;
      await seed(S6, AGENT_A, SLUG, "1.5.0", 12);
      const r = await finalizePublication(S6);
      assert.equal(r.outcome, "not_ready");
      if (r.outcome === "not_ready") assert.equal(r.step, "update-version");
      assert.equal((await sub(S6)).status, "awaiting_creator_signature");
      assert.equal(publishedVersionOf(join(PUBLISHED, SLUG)), "1.4.0");
    });
  });

  // ---------- O evento da cadeia finaliza sozinho ----------

  describe("Evento da cadeia", () => {
    it("AgentStatusChanged(Active) de um Solver novo aguardando o admin finaliza a publicação e grava approve_tx", async () => {
      const E = `${PREFIX}-e1`;
      const slug = `${PREFIX}-evento`;
      const { approved } = await seed(E, AGENT_B, slug, "1.0.0", 8, "awaiting_onchain_approval");
      await fake.indexSignature(fake.land("register-agent", CREATOR, AGENT_B, approved));
      const pda = fake.pda(AGENT_B);

      // Suspender (status 2) ou evento de um agente desconhecido não destrava nada.
      assert.equal(await onPublishEvent({ name: "AgentStatusChanged", data: { agent: pda, status: 2 } } as never, "sig-x"), null);
      assert.equal(await onPublishEvent({ name: "AgentStatusChanged", data: { agent: "pda-desconhecido", status: 1 } } as never, "sig-y"), null);
      // Ainda Pending na cadeia: o evento chega adiantado e nada acontece.
      const early = await onPublishEvent({ name: "AgentStatusChanged", data: { agent: pda, status: 1 } } as never, "sig-cedo");
      assert.equal(early?.result?.outcome, "not_ready");
      assert.equal((await sub(E)).status, "awaiting_onchain_approval");

      // O admin aprovou por outro caminho (cli:admin, outra máquina): o evento finaliza.
      fake.accounts.get(AGENT_B)!.status = "active";
      await fake.syncAgent(AGENT_B);
      const approvalSig = "sig-approve-evento".padEnd(64, "x");
      const r = await onPublishEvent({ name: "AgentStatusChanged", data: { agent: pda, status: 1 } } as never, approvalSig);
      assert.deepEqual(r?.result, { outcome: "published", version: "1.0.0" });
      const s = await sub(E);
      assert.equal(s.status, "published");
      assert.equal(s.approveTx, approvalSig);
      assert.equal((await agent(AGENT_B)).listed, true);
      assert.equal((await reviews(E, "finish")).length, 0, "finalização pelo evento não é ação do admin");
    });
  });

  // ---------- Indexador: versão aprovada x cadeia ----------

  describe("Indexador (sync_flag)", () => {
    const acc = (over: Record<string, unknown> = {}) => ({ creator: CREATOR, version: "1.0.0", versionHash: H("1"), price: 7_000_000n, royaltyBps: 500, status: "active" as const, ...over });
    const mirror = async (over: Record<string, unknown> = {}) => mirrorAgentAccount(fake.pda(AGENT_C) as never, fake.asAgentAccount(AGENT_C, acc(over)));

    it("registrado fora da plataforma (nenhuma versão aprovada): a linha nasce marcada e fora da vitrine", async () => {
      await mirror();
      const a = await agent(AGENT_C);
      assert.equal(a.syncFlag, "unapproved_chain_version");
      assert.equal(a.listed, false);
    });

    it("aprovação cobrindo o hash: volta a ok e o espelho passa a copiar versão, hash e preço", async () => {
      await db.insert(schema.agentPublishedVersions).values({ agentId: AGENT_C, version: "1.0.0", versionHash: H("1"), priceUsdc: 7_000_000n });
      await mirror();
      const a = await agent(AGENT_C);
      assert.equal(a.syncFlag, "ok");
      assert.equal(a.version, "1.0.0");
      assert.equal(a.price, 7_000_000n);
      assert.equal(a.status, "active");
    });

    it("update_version/update_pricing direto na cadeia: marca, mantém o aprovado na vitrine e continua espelhando o resto", async () => {
      await mirror({ version: "1.0.1", versionHash: H("2"), price: 1_000_000n });
      const a = await agent(AGENT_C);
      assert.equal(a.syncFlag, "unapproved_chain_version");
      assert.equal(a.version, "1.0.0");
      assert.equal(a.versionHash, H("1"));
      assert.equal(a.price, 7_000_000n);
      await mirror({ version: "1.0.1", versionHash: H("2"), price: 1_000_000n, status: "suspended" });
      assert.equal((await agent(AGENT_C)).status, "suspended", "o status da cadeia segue sendo espelhado");
    });

    it("só o preço mudado também diverge; reverter na cadeia volta a ok", async () => {
      await mirror({ price: 99_000_000n });
      assert.equal((await agent(AGENT_C)).syncFlag, "unapproved_chain_version");
      await mirror();
      const a = await agent(AGENT_C);
      assert.equal(a.syncFlag, "ok");
      assert.equal(a.price, 7_000_000n);
    });

    it("uma nova aprovação cobrindo aquele hash volta a ok e a vitrine acompanha", async () => {
      await mirror({ version: "1.0.1", versionHash: H("2"), price: 1_000_000n });
      assert.equal((await agent(AGENT_C)).syncFlag, "unapproved_chain_version");
      await db.insert(schema.agentPublishedVersions).values({ agentId: AGENT_C, version: "1.0.1", versionHash: H("2"), priceUsdc: 1_000_000n });
      await mirror({ version: "1.0.1", versionHash: H("2"), price: 1_000_000n });
      const a = await agent(AGENT_C);
      assert.equal(a.syncFlag, "ok");
      assert.equal(a.version, "1.0.1");
      assert.equal(a.price, 1_000_000n);
    });

    it("o indexador nunca escreve platform_status", async () => {
      await db.update(schema.agents).set({ platformStatus: "suspended" }).where(d.eq(schema.agents.id, AGENT_C));
      await mirror({ version: "1.0.1", versionHash: H("2"), price: 1_000_000n });
      await mirror({ version: "9.9.9", versionHash: H("9"), price: 3n });
      assert.equal((await agent(AGENT_C)).platformStatus, "suspended");
      await db.update(schema.agents).set({ platformStatus: "active" }).where(d.eq(schema.agents.id, AGENT_C));
    });

    describe("assertFreshPrice (bloqueio da venda)", () => {
      const row = (over: Record<string, unknown> = {}) => ({ id: AGENT_C, price: 7_000_000n, syncFlag: "ok", ...over });
      const chainOf = (over: Record<string, unknown> = {}) => async () => ({ address: "pda", version: "1.0.0", versionHash: H("1"), price: 7_000_000n, ...over });
      const mk = (readChain: () => Promise<unknown>, synced: string[] = []) => ({
        readChain: readChain as never,
        approvedVersions: async () => [{ version: "1.0.0", versionHash: H("1"), priceUsdc: 7_000_000n }],
        sync: async (a: string) => void synced.push(a),
      });
      const code = (e: unknown) => (e as { status?: number; code?: string });

      it("cadeia igual ao aprovado e ao preço mostrado: libera", async () => {
        const synced: string[] = [];
        await assertFreshPrice(row() as never, mk(chainOf(), synced));
        assert.deepEqual(synced, []);
      });

      it("conta inexistente na cadeia: não decide aqui", async () => {
        await assertFreshPrice(row() as never, mk(async () => null));
      });

      it("hash ou preço da cadeia sem aprovação: 409 price_in_review (e espelha para levantar a marca)", async () => {
        for (const over of [{ versionHash: H("3") }, { price: 2_000_000n }, { version: "2.0.0" }]) {
          const synced: string[] = [];
          await assert.rejects(assertFreshPrice(row() as never, mk(chainOf(over), synced)), (e) => code(e).status === 409 && code(e).code === "price_in_review");
          assert.deepEqual(synced, ["pda"]);
        }
        const synced: string[] = [];
        await assert.rejects(assertFreshPrice(row({ syncFlag: "unapproved_chain_version" }) as never, mk(chainOf({ price: 2_000_000n }), synced)), (e) => code(e).code === "price_in_review");
        assert.deepEqual(synced, [], "já marcado: não espelha de novo");
      });

      it("a cadeia reverteu: com a linha ainda marcada, espelha (limpa a marca) e libera a venda", async () => {
        const synced: string[] = [];
        await assertFreshPrice(row({ syncFlag: "unapproved_chain_version" }) as never, mk(chainOf(), synced));
        assert.deepEqual(synced, ["pda"]);
      });

      it("preço aprovado diferente do mostrado (update_pricing aprovado): continua 409 price_changed, com o novo valor", async () => {
        const approvedLater = { ...mk(chainOf({ price: 9_000_000n })), approvedVersions: async () => [{ version: "1.0.0", versionHash: H("1"), priceUsdc: 9_000_000n }] };
        await assert.rejects(assertFreshPrice(row() as never, approvedLater), (e) => code(e).code === "price_changed" && (e as unknown as { extra: { priceUsdc: number } }).extra.priceUsdc === 9);
      });
    });
  });

  // ---------- Kill switch ----------

  describe("Suspensão", () => {
    const SLUG = `${PREFIX}-novo`;
    const S = `${PREFIX}-sess`;

    it("suspende na plataforma e na cadeia, derruba a sessão aberta e deixa trilha", async () => {
      const published = (await db.select().from(schema.packageSubmissions).where(d.and(d.eq(schema.packageSubmissions.agentId, AGENT_A), d.eq(schema.packageSubmissions.status, "published"))))[0]!;
      await db.insert(schema.sessions).values({ id: S, wallet: `${PREFIX}-buyer`, agentId: AGENT_A, version: "1.4.0", access: "trial" });
      assert.equal((await getSession(S, `${PREFIX}-buyer`)).id, S);

      const r = await suspendSolver(SLUG, { reason: "conteúdo copiado de terceiros", port: fake });
      assert.equal(r.action, "suspend");
      assert.equal(r.platformChanged, true);
      assert.ok(r.chainTx);
      assert.equal(r.submissionId, published.id);
      assert.equal(fake.accounts.get(AGENT_A)!.status, "suspended");
      const a = await agent(AGENT_A);
      assert.equal(a.platformStatus, "suspended");
      assert.equal(a.status, "suspended", "o status da cadeia foi espelhado");
      assert.equal((await sub(published.id)).status, "suspended");
      const trail = await reviews(published.id, "suspend");
      assert.equal(trail.length, 1);
      assert.equal(trail[0]!.reviewerWallet, "AdminOnchainWallet");
      assert.equal(trail[0]!.notes, "conteúdo copiado de terceiros");
      await assert.rejects(getSession(S, `${PREFIX}-buyer`), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");
    });

    it("o evento do indexador não reativa (a coluna da plataforma é separada) e rodar de novo não duplica a trilha", async () => {
      fake.accounts.get(AGENT_A)!.status = "active"; // a cadeia diz Active (por exemplo, um evento de venda)
      await fake.syncAgent(AGENT_A);
      assert.equal((await agent(AGENT_A)).platformStatus, "suspended");
      await assert.rejects(getSession(S, `${PREFIX}-buyer`), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");

      // Nova tentativa (a cadeia voltou a Active por fora): completa o suspend_agent, sem nova linha de trilha.
      const again = await suspendSolver(SLUG, { port: fake });
      assert.equal(again.platformChanged, false);
      assert.ok(again.chainTx, "a conta voltou a Active: suspende de novo na cadeia");
      const published = (await db.select().from(schema.packageSubmissions).where(d.and(d.eq(schema.packageSubmissions.agentId, AGENT_A), d.eq(schema.packageSubmissions.status, "suspended"))))[0]!;
      assert.equal((await reviews(published.id, "suspend")).length, 1);
    });

    it("se o suspend_agent falhar, o Solver já está suspenso na plataforma e o erro explica", async () => {
      await suspendSolver(SLUG, { resume: true, port: fake });
      fake.failSuspend = true;
      await assert.rejects(suspendSolver(SLUG, { port: fake }), (e: unknown) => e instanceof SuspendError && /on-chain falhou/.test((e as Error).message));
      assert.equal((await agent(AGENT_A)).platformStatus, "suspended");
      await assert.rejects(getSession(S, `${PREFIX}-buyer`), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");
      fake.failSuspend = false;
      const retry = await suspendSolver(SLUG, { port: fake });
      assert.equal(retry.platformChanged, false);
      assert.ok(retry.chainTx);
    });

    it("reativar: approve_agent na cadeia, platform_status active, submissão de volta a published e a sessão volta", async () => {
      fake.calls.length = 0;
      const r = await suspendSolver(SLUG, { resume: true, reason: "revisado", port: fake });
      assert.equal(r.action, "resume");
      assert.ok(r.chainTx);
      assert.deepEqual(fake.calls, [`approve:${AGENT_A}`]);
      assert.equal(fake.accounts.get(AGENT_A)!.status, "active");
      const a = await agent(AGENT_A);
      assert.equal(a.platformStatus, "active");
      assert.equal(a.status, "active");
      const s = await sub(r.submissionId!);
      assert.equal(s.status, "published");
      assert.equal((await reviews(s.id, "resume")).length, 2, "uma linha por mudança de estado: a deste e a do teste anterior");
      assert.equal((await getSession(S, `${PREFIX}-buyer`)).id, S);
    });

    it("finalizar uma versão nova de um Solver suspenso pela plataforma é recusado (não levanta a suspensão sem querer)", async () => {
      const S7 = `${PREFIX}-s7`;
      const { approved } = await seed(S7, AGENT_A, SLUG, "1.6.0", 12);
      await fake.indexSignature(fake.land("update-version", CREATOR, AGENT_A, approved));
      await db.update(schema.agents).set({ platformStatus: "suspended" }).where(d.eq(schema.agents.id, AGENT_A));
      const r = await finalizePublication(S7);
      assert.equal(r.outcome, "not_ready");
      assert.match(r.outcome === "not_ready" ? r.reason : "", /suspenso/);
      assert.equal((await sub(S7)).status, "awaiting_creator_signature");
      await db.update(schema.agents).set({ platformStatus: "active" }).where(d.eq(schema.agents.id, AGENT_A));
    });

    it("Solver inexistente: erro claro", async () => {
      await assert.rejects(suspendSolver(`${PREFIX}-nao-existe`, { port: fake }), SuspendError);
    });
  });
});

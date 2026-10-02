import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AdminSubmissionDetail } from "@solvers/shared";
import { baseFiles, editManifest, type Files } from "./validate-fixtures.js";
import { buildZip, zipOfFiles } from "./helpers/zip-builder.js";

// Envio de pacotes de ponta a ponta contra um Postgres real, pelas rotas HTTP de verdade (sem Privy nem cadeia):
// convite e perfil, upload em streaming, worker (extração, validação, varreduras, ingestão em staging), revisão do admin.
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.

const url = process.env.TEST_DATABASE_URL;
const P = `b1t${Date.now().toString(36)}`; // prefixo único por execução (package_reviews é somente-inserção: não dá para apagar)
const MAX_ZIP = 60_000;

describe("envio de pacotes com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let eq: typeof import("drizzle-orm").eq;
  let like: typeof import("drizzle-orm").like;
  let inArray: typeof import("drizzle-orm").inArray;
  let server: Server;
  let base = "";
  let root = "";
  let cookie: (wallet: string) => Promise<string>;
  let proc: typeof import("../src/submissions/process.js");
  let review: typeof import("../src/submissions/review.js");
  let hashOf: typeof import("../src/review/hash.js").packageHashOf;
  let folderInput: typeof import("../src/runtime/validate/input.js").packageFromFolder;

  const ADMIN = `${P}-admin`;
  const A = `${P}-creatora`; // criador convidado com perfil
  const B = `${P}-creatorb`; // outro criador convidado
  const NEWBIE = `${P}-newbie`; // sem perfil
  const NOT_INVITED = `${P}-semconvite`; // perfil criado por outro caminho, sem convite
  const code = (n: string) => `B1T${P.toUpperCase()}${n}`.slice(0, 40);

  const api = async (method: string, path: string, opts: { wallet?: string | null; body?: unknown; raw?: BodyInit; type?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.wallet) headers.cookie = await cookie(opts.wallet);
    let body: BodyInit | undefined;
    if (opts.raw !== undefined) {
      body = opts.raw;
      headers["content-type"] = opts.type ?? "application/zip";
    } else if (opts.body !== undefined && method !== "GET") {
      body = JSON.stringify(opts.body);
      headers["content-type"] = "application/json";
    }
    const res = await fetch(`${base}/api${path}`, { method, headers, body, ...(body && typeof body === "object" && "getReader" in body ? { duplex: "half" } : {}) } as RequestInit);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, headers: res.headers, text };
  };
  const upload = (wallet: string | null, zip: Buffer | Files | BodyInit, query = "") =>
    api("POST", `/creator/submissions${query}`, { wallet, raw: Buffer.isBuffer(zip) || typeof (zip as any)?.getReader === "function" ? (zip as BodyInit) : (zipOfFiles(zip as Files) as unknown as BodyInit) });

  const files = (over: (f: Files) => void = () => undefined): Files => {
    const f = baseFiles();
    editManifest(f, (m) => {
      m.slug = `${P}-solver`;
    });
    over(f);
    return f;
  };
  const dirs = () => readdirSync(root);

  // Processa uma submissão com a ingestão REAL (SEARCH_MODE=fts: sem modelo, só texto) e avisos que não vão a lugar nenhum.
  const work = async (id: string) => {
    const sent: string[] = [];
    const out = await proc.processSubmission(id, { ...proc.defaultProcessDeps, notifyAdmin: async (t) => void sent.push(t), notifyCreator: async (_w, t) => void sent.push(t), minPriceUnits: async () => 5_000_000n });
    return { out, sent };
  };
  const row = async (id: string) => (await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id)))[0]!;

  const CHECK = { promiseDelivered: true, twoDifferentiatorsProven: true, rightsAndSources: true, noHarmfulInstructions: true, priceTrialShowcaseCoherent: true };

  async function cleanup() {
    const subs = await db.select({ id: schema.packageSubmissions.id, agentId: schema.packageSubmissions.agentId }).from(schema.packageSubmissions).where(like(schema.packageSubmissions.creatorWallet, `${P}%`));
    const ids = subs.map((s) => s.id);
    if (ids.length) {
      await db.delete(schema.ingestJobs).where(inArray(schema.ingestJobs.submissionId, ids));
      for (const id of ids) await db.delete(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.version, `staging:${id}`));
    }
    await db.delete(schema.packageSubmissions).where(like(schema.packageSubmissions.creatorWallet, `${P}%`));
    if (subs.length) await db.delete(schema.agentPublishedVersions).where(inArray(schema.agentPublishedVersions.agentId, subs.map((s) => s.agentId)));
    await db.delete(schema.creatorInvites).where(like(schema.creatorInvites.code, `B1T${P.toUpperCase()}%`));
    await db.delete(schema.creators).where(like(schema.creators.wallet, `${P}%`));
  }

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "solvers-sub-"));
    Object.assign(process.env, {
      DATABASE_URL: url,
      USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      FEE_PAYER_KEYPAIR: process.env.FEE_PAYER_KEYPAIR ?? "x",
      VERIFIER_KEYPAIR: process.env.VERIFIER_KEYPAIR ?? "x",
      USAGE_AUTHORITY_KEYPAIR: process.env.USAGE_AUTHORITY_KEYPAIR ?? "x",
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
      SEARCH_MODE: "fts",
      SUBMISSIONS_DIR: root,
      PUBLISHED_DIR: join(root, "published"),
      ADMIN_WALLETS: `${ADMIN}, outro-admin`,
      SUBMISSION_MAX_ZIP_BYTES: String(MAX_ZIP),
      SUBMISSION_MAX_PENDING: "100",
      SUBMISSION_MAX_PER_DAY: "100",
      SUBMISSIONS_INLINE: "false",
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    ({ eq, like, inArray } = await import("drizzle-orm"));
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");
    const { signSession, SESSION_COOKIE } = await import("../src/auth/jwt.js");
    cookie = async (wallet) => `${SESSION_COOKIE}=${await signSession(wallet)}`;
    proc = await import("../src/submissions/process.js");
    review = await import("../src/submissions/review.js");
    ({ packageHashOf: hashOf } = await import("../src/review/hash.js"));
    ({ packageFromFolder: folderInput } = await import("../src/runtime/validate/input.js"));

    await cleanup();
    await db.insert(schema.creators).values([
      { id: `${P}-ca`, wallet: A, name: "Criadora A", bio: "Bio da criadora A com mais de dez caracteres", invited: true, termsAcceptedAt: new Date() },
      { id: `${P}-cb`, wallet: B, name: "Criador B", bio: "Bio do criador B com mais de dez caracteres", invited: true, termsAcceptedAt: new Date() },
      { id: `${P}-cn`, wallet: NOT_INVITED, name: "Sem convite", bio: "Perfil sem convite nem termos", invited: false },
    ]);
    await new Promise<void>((resolve) => {
      server = createApp(mounts).listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    server?.close();
    if (db) {
      await cleanup();
      await pool.end();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("convites e perfil", () => {
    it("GET /creator/me exige login e diz quem é admin", async () => {
      assert.equal((await api("GET", "/creator/me")).status, 401);
      const me = (await api("GET", `/creator/me`, { wallet: A })).json;
      assert.deepEqual({ hasProfile: me.hasProfile, invited: me.invited, termsAccepted: me.termsAccepted, canSubmit: me.canSubmit, isAdmin: me.isAdmin, contactVerified: me.contactVerified }, { hasProfile: true, invited: true, termsAccepted: true, canSubmit: true, isAdmin: false, contactVerified: false });
      const adm = (await api("GET", `/creator/me`, { wallet: ADMIN })).json;
      assert.equal(adm.isAdmin, true);
      assert.equal(adm.hasProfile, false);
      assert.equal(adm.canSubmit, false);
    });

    it("1º cadastro exige convite; código inexistente e reutilizado são recusados; o válido vincula a carteira", async () => {
      await db.insert(schema.creatorInvites).values({ code: code("OK1"), email: "a@b.c" });
      const profile = { name: "Fulano Criador", bio: "Contador há dez anos, ajudo MEIs.", acceptTerms: true };
      assert.equal((await api("POST", "/creator/profile", { wallet: NEWBIE, body: profile })).json.code, "invite_required");
      assert.equal((await api("POST", "/creator/profile", { wallet: NEWBIE, body: { ...profile, inviteCode: "NAOEXISTE123" } })).json.code, "invite_invalid");
      assert.equal((await api("POST", "/creator/profile", { wallet: NEWBIE, body: { ...profile, acceptTerms: false, inviteCode: code("OK1") } })).status, 400, "sem aceitar os termos");
      assert.equal((await db.select().from(schema.creators).where(eq(schema.creators.wallet, NEWBIE))).length, 0, "falhas não deixam perfil nem consomem o convite");

      const ok = await api("POST", "/creator/profile", { wallet: NEWBIE, body: { ...profile, inviteCode: ` ${code("OK1").toLowerCase()} ` } });
      assert.equal(ok.status, 200, ok.text);
      assert.deepEqual({ hasProfile: ok.json.hasProfile, invited: ok.json.invited, termsAccepted: ok.json.termsAccepted, canSubmit: ok.json.canSubmit }, { hasProfile: true, invited: true, termsAccepted: true, canSubmit: true });
      const [inv] = await db.select().from(schema.creatorInvites).where(eq(schema.creatorInvites.code, code("OK1")));
      assert.equal(inv!.wallet, NEWBIE);
      assert.ok(inv!.usedAt);
      const [c] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, NEWBIE));
      assert.ok(c!.invited && c!.termsAcceptedAt && /^cr_[0-9a-f]{16}$/.test(c!.id));

      // Outra carteira com o mesmo código: recusado, e o convite continua sendo de quem o usou.
      const again = await api("POST", "/creator/profile", { wallet: `${P}-intruso`, body: { ...profile, inviteCode: code("OK1") } });
      assert.deepEqual([again.status, again.json.code], [409, "invite_used"]);
      assert.equal((await db.select().from(schema.creatorInvites).where(eq(schema.creatorInvites.code, code("OK1"))))[0]!.wallet, NEWBIE);
      assert.equal((await db.select().from(schema.creators).where(eq(schema.creators.wallet, `${P}-intruso`))).length, 0);
    });

    it("quem já é convidado atualiza o perfil sem código; perfil sem convite exige código", async () => {
      const up = await api("POST", "/creator/profile", { wallet: NEWBIE, body: { name: "Novo Nome", bio: "Outra bio com mais de dez caracteres", acceptTerms: true } });
      assert.equal(up.status, 200);
      assert.equal(up.json.name, "Novo Nome");
      await db.insert(schema.creatorInvites).values({ code: code("OK2") });
      const claim = await api("POST", "/creator/profile", { wallet: NOT_INVITED, body: { name: "Sem Convite", bio: "Agora com convite, mais de dez", acceptTerms: true, inviteCode: code("OK2") } });
      assert.equal(claim.json.canSubmit, true);
      assert.equal((await db.select().from(schema.creators).where(eq(schema.creators.wallet, NOT_INVITED)))[0]!.id, `${P}-cn`, "mantém a linha que já existia");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("upload", () => {
    it("sem login responde 401 ANTES de ler o corpo e não grava nada", async () => {
      const before = dirs().length;
      const r = await upload(null, Buffer.alloc(MAX_ZIP * 2, 7));
      assert.equal(r.status, 401);
      assert.equal(dirs().length, before);
    });

    it("sem perfil, sem convite ou sem termos: 403 antes de ler o corpo", async () => {
      const before = dirs().length;
      await db.update(schema.creators).set({ invited: false }).where(eq(schema.creators.wallet, NOT_INVITED));
      for (const wallet of [`${P}-sem-perfil`, NOT_INVITED]) {
        const r = await upload(wallet, Buffer.alloc(1000, 1));
        assert.equal(r.status, 403, wallet);
        assert.equal(r.json.code, "forbidden");
      }
      await db.update(schema.creators).set({ invited: true, termsAcceptedAt: null }).where(eq(schema.creators.wallet, NOT_INVITED));
      assert.equal((await upload(NOT_INVITED, Buffer.alloc(1000, 1))).status, 403, "sem termos");
      assert.equal(dirs().length, before);
    });

    it("tipo de conteúdo errado: 415; corpo vazio e não-ZIP: 400, sem sobras no disco", async () => {
      const before = dirs().length;
      assert.equal((await api("POST", "/creator/submissions", { wallet: A, raw: "{}", type: "application/json" })).status, 415);
      assert.equal((await upload(A, Buffer.alloc(0))).status, 400);
      const notZip = await upload(A, Buffer.from("isto não é um zip, mas tem alguns bytes"));
      assert.deepEqual([notZip.status, notZip.json.code], [400, "not_a_zip"]);
      assert.equal(dirs().length, before, "nenhuma pasta ficou para trás");
    });

    it("acima do teto: 413 pelo Content-Length e também em streaming sem Content-Length, sem sobras", async () => {
      const before = dirs().length;
      const big = await upload(A, Buffer.alloc(MAX_ZIP + 1, 7));
      assert.deepEqual([big.status, big.json?.code], [413, "payload_too_large"]);
      // Sem Content-Length (transferência em pedaços): a contagem em streaming derruba.
      const chunk = Buffer.alloc(20_000, 7);
      const stream = new ReadableStream({
        start(c) {
          for (let i = 0; i < 5; i++) c.enqueue(chunk);
          c.close();
        },
      });
      const chunked = await upload(A, stream as unknown as BodyInit);
      assert.equal(chunked.status, 413);
      assert.equal(dirs().length, before);
    });

    it("ZIP válido: 202 { id, status: submitted }, ZIP gravado no disco e linha criada com o servidor como dono do agentId", async () => {
      const r = await upload(A, files());
      assert.equal(r.status, 202, r.text);
      assert.equal(r.json.status, "submitted");
      assert.match(r.json.id, /^[0-9a-f]{24}$/);
      assert.ok(existsSync(join(root, r.json.id, "package.zip")));
      const s = await row(r.json.id);
      assert.deepEqual([s.status, s.creatorWallet, s.slug, s.version, s.zipPath], ["submitted", A, "", "", `${r.json.id}/package.zip`]);
      assert.match(s.agentId, /^[0-9a-f]{32}$/);
      assert.ok(s.sizeBytes > 0 && s.sizeBytes <= MAX_ZIP);
      assert.ok(!existsSync(join(root, r.json.id, "package.zip.part")));
    });

    // Os limites são lidos do env a cada requisição: o teste os baixa só enquanto roda e restaura no fim.
    const withLimits = async (limits: { pending?: number; perDay?: number }, fn: () => Promise<void>) => {
      const { env } = await import("../src/env.js");
      const old = { p: env.SUBMISSION_MAX_PENDING, d: env.SUBMISSION_MAX_PER_DAY };
      env.SUBMISSION_MAX_PENDING = limits.pending ?? old.p;
      env.SUBMISSION_MAX_PER_DAY = limits.perDay ?? old.d;
      try {
        await fn();
      } finally {
        env.SUBMISSION_MAX_PENDING = old.p;
        env.SUBMISSION_MAX_PER_DAY = old.d;
      }
    };

    it("limite de pendentes: 429 too_many_pending, sem sobras no disco", async () => {
      const w = `${P}-limites`;
      await db.insert(schema.creators).values({ id: `${P}-cl`, wallet: w, name: "Limites", bio: "Bio para testar limites", invited: true, termsAcceptedAt: new Date() });
      await withLimits({ pending: 3 }, async () => {
        for (let i = 0; i < 3; i++) assert.equal((await upload(w, files())).status, 202, `envio ${i}`);
        const before = dirs().length;
        const fourth = await upload(w, files());
        assert.deepEqual([fourth.status, fourth.json.code], [429, "too_many_pending"]);
        assert.equal(dirs().length, before);
        // Reenviar uma submissão que pediu mudanças não conta como envio novo (já está aberta).
        const [one] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.creatorWallet, w));
        await db.update(schema.packageSubmissions).set({ status: "changes_requested" }).where(eq(schema.packageSubmissions.id, one!.id));
        assert.equal((await upload(w, files(), `?resubmit=${one!.id}`)).status, 202);
      });
    });

    it("limite por dia: 429 too_many_per_day mesmo sem pendentes", async () => {
      const w = `${P}-dia`;
      await db.insert(schema.creators).values({ id: `${P}-cd`, wallet: w, name: "Dia", bio: "Bio para testar o limite do dia", invited: true, termsAcceptedAt: new Date() });
      await withLimits({ perDay: 5 }, async () => {
        for (let i = 0; i < 4; i++) assert.equal((await upload(w, files())).status, 202);
        await db.update(schema.packageSubmissions).set({ status: "rejected_validation" }).where(eq(schema.packageSubmissions.creatorWallet, w));
        assert.equal((await upload(w, files())).status, 202, "o 5º ainda cabe");
        await db.update(schema.packageSubmissions).set({ status: "rejected_validation" }).where(eq(schema.packageSubmissions.creatorWallet, w));
        const sixth = await upload(w, files());
        assert.deepEqual([sixth.status, sixth.json.code], [429, "too_many_per_day"]);
      });
    });

    it("uploads simultâneos não furam o limite de pendentes", async () => {
      const w = `${P}-corrida`;
      await db.insert(schema.creators).values({ id: `${P}-cc`, wallet: w, name: "Corrida", bio: "Bio para testar corrida", invited: true, termsAcceptedAt: new Date() });
      await withLimits({ pending: 3 }, async () => {
        const results = await Promise.all(Array.from({ length: 6 }, () => upload(w, files())));
        assert.equal(results.filter((r) => r.status === 202).length, 3);
        assert.equal(results.filter((r) => r.status === 429).length, 3);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("worker", () => {
    it("ZIP válido: extrai, valida (terceiro), grava slug/versão/manifesto com id e creator.id do servidor, varre e ingere em staging", async () => {
      const r = await upload(A, files());
      const id: string = r.json.id;
      const { out, sent } = await work(id);
      assert.equal(out, "pending_review");
      const s = await row(id);
      assert.equal(s.status, "pending_review");
      assert.deepEqual([s.slug, s.version], [`${P}-solver`, "1.0.0"]);
      assert.equal((s.validation as any).ok, true, JSON.stringify((s.validation as any).errors));
      const m = s.manifest as Record<string, any>;
      assert.equal(m.id, s.agentId, "o servidor atribui o id");
      assert.equal(m.creator.id, `${P}-ca`, "creator.id é o do perfil, não o do ZIP");
      const onDisk = JSON.parse(await readFile(join(root, id, "extracted", "manifest.json"), "utf8"));
      assert.equal(onDisk.id, s.agentId);
      assert.ok((s.scans as any).report.counts && (s.scans as any).diff.files.length > 0);
      assert.ok((s.scans as any).diff.files.every((f: any) => f.diff === "added"), "1ª versão: tudo novo");
      const [job] = await db.select().from(schema.ingestJobs).where(eq(schema.ingestJobs.submissionId, id));
      assert.equal(job!.status, "done");
      assert.ok(job!.filesTotal === 2 && job!.filesDone === 2 && job!.chunksDone >= 2, JSON.stringify(job));
      const chunks = await db.select().from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.version, `staging:${id}`));
      assert.ok(chunks.length >= 2 && chunks.every((c) => c.agentId === s.agentId));
      assert.ok(sent.some((t) => t.includes("espera revisão")), "avisa o admin");
      assert.ok(sent.some((t) => t.includes("fila de revisão")), "avisa o criador");
    });

    it("o mesmo criador reaproveita o agentId do slug nas versões seguintes; versão repetida é recusada", async () => {
      const first = (await db.select().from(schema.packageSubmissions).where(like(schema.packageSubmissions.slug, `${P}-solver`)).limit(1))[0]!;
      const r = await upload(A, files((f) => editManifest(f, (m) => ((m.version = "1.1.0"), (m.versions = [{ version: "1.1.0", releasedAt: "2026-10-02", notes: "Nova" }])))));
      assert.equal((await work(r.json.id)).out, "pending_review");
      assert.equal((await row(r.json.id)).agentId, first.agentId, "mesmo Solver");
      // Mesma versão de novo, enquanto a outra está viva: erro com código do catálogo.
      const dup = await upload(A, files((f) => editManifest(f, (m) => ((m.version = "1.1.0"), (m.versions = [{ version: "1.1.0", releasedAt: "2026-10-02", notes: "Nova" }])))));
      assert.equal((await work(dup.json.id)).out, "rejected_validation");
      assert.ok(((await row(dup.json.id)).validation as any).errors.some((e: any) => e.code === "MANIFEST_VERSION_NOT_GREATER"));
    });

    it("outro criador não pode usar o slug nem o id de um Solver que já é de alguém", async () => {
      const mine = (await db.select().from(schema.packageSubmissions).where(like(schema.packageSubmissions.slug, `${P}-solver`)).limit(1))[0]!;
      const bySlug = await upload(B, files());
      assert.equal((await work(bySlug.json.id)).out, "rejected_validation");
      assert.ok(((await row(bySlug.json.id)).validation as any).errors.some((e: any) => e.code === "MANIFEST_ID_OWNER" && e.path.endsWith("#slug")));
      const byId = await upload(B, files((f) => editManifest(f, (m) => ((m.slug = `${P}-outro`), (m.id = mine.agentId)))));
      assert.equal((await work(byId.json.id)).out, "rejected_validation");
      assert.ok(((await row(byId.json.id)).validation as any).errors.some((e: any) => e.code === "MANIFEST_ID_OWNER"));
    });

    it("pacote ruim vira rejected_validation com os códigos do catálogo (zip-slip, symlink, manifesto, preço)", async () => {
      const slip = await upload(A, buildZip([{ name: "p/manifest.json", data: "{}" }, { name: "p/../../fora.md", data: "x" }]));
      assert.equal((await work(slip.json.id)).out, "rejected_validation");
      const v = (await row(slip.json.id)).validation as any;
      assert.equal(v.ok, false);
      assert.ok(v.errors.some((e: any) => e.code === "ZIP_BAD_PATH"));
      assert.ok(!existsSync(join(root, slip.json.id, "extracted")), "nada extraído");

      const cheap = await upload(B, files((f) => editManifest(f, (m) => ((m.slug = `${P}-barato`), (m.pricing = { priceUsdc: 3, royaltyBps: 0 })))));
      assert.equal((await work(cheap.json.id)).out, "rejected_validation");
      assert.ok(((await row(cheap.json.id)).validation as any).errors.some((e: any) => e.code === "MANIFEST_PRICE_BELOW_MIN"));
      assert.equal((await row(cheap.json.id)).slug, `${P}-barato`, "slug seguro aparece mesmo reprovado");

      const nomanifest = await upload(B, buildZip([{ name: "p/steps/01.md", data: "x" }]));
      await work(nomanifest.json.id);
      assert.ok(((await row(nomanifest.json.id)).validation as any).errors.some((e: any) => e.code === "ZIP_BAD_ROOT"));
    });

    it("retoma depois de uma falha na ingestão: não valida de novo e recomeça do último arquivo concluído", async () => {
      const r = await upload(B, files((f) => editManifest(f, (m) => (m.slug = `${P}-retoma`))));
      const id: string = r.json.id;
      const calls: { resume: number | undefined; version: string }[] = [];
      let fail = true;
      let validations = 0;
      const deps: typeof proc.defaultProcessDeps = {
        ...proc.defaultProcessDeps,
        notifyAdmin: async () => undefined,
        notifyCreator: async () => undefined,
        minPriceUnits: async () => {
          validations += 1;
          return 5_000_000n;
        },
        ingest: async (o) => {
          calls.push({ resume: o.resumeFromFile, version: o.version });
          await o.onFile?.((o.resumeFromFile ?? 0) + 1, 2, 3);
          if (fail) {
            fail = false;
            throw new Error("modelo caiu");
          }
          await o.onFile?.(2, 2, 6);
          return { files: 2, chunks: 6 };
        },
      };
      await assert.rejects(proc.processSubmission(id, deps), /modelo caiu/);
      let s = await row(id);
      assert.equal(s.status, "validating");
      assert.match(s.error ?? "", /modelo caiu/);
      const [job] = await db.select().from(schema.ingestJobs).where(eq(schema.ingestJobs.submissionId, id));
      assert.deepEqual([job!.status, job!.filesDone], ["failed", 1]);

      assert.equal(await proc.processSubmission(id, deps), "pending_review");
      s = await row(id);
      assert.equal(s.error, null);
      assert.deepEqual(calls, [{ resume: 0, version: `staging:${id}` }, { resume: 1, version: `staging:${id}` }]);
      assert.equal(validations, 1, "a validação rodou uma vez só");
    });

    it("modo inline (SUBMISSIONS_INLINE): o próprio servidor processa depois do 202, sem o worker", async () => {
      const { env } = await import("../src/env.js");
      env.SUBMISSIONS_INLINE = true;
      try {
        const r = await upload(B, files((f) => editManifest(f, (m) => (m.slug = `${P}-inline`))));
        assert.equal(r.status, 202);
        let status = "";
        for (let i = 0; i < 100 && status !== "pending_review"; i++) {
          await new Promise((ok) => setTimeout(ok, 100));
          status = (await row(r.json.id)).status;
        }
        assert.equal(status, "pending_review");
      } finally {
        env.SUBMISSIONS_INLINE = false;
      }
    });

    it("o worker só pega submitted e validating, e uma submissão já processada é pulada", async () => {
      const w = await import("../src/worker/index.js");
      const pending = await w.pendingSubmissionIds(200);
      const rows = await db.select().from(schema.packageSubmissions).where(inArray(schema.packageSubmissions.id, pending));
      assert.ok(rows.every((r) => ["submitted", "validating"].includes(r.status)));
      const done = (await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.status, "pending_review")))[0]!;
      assert.equal(await proc.processSubmission(done.id), "skipped");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("criador: consulta", () => {
    it("lista só os seus envios, sem caminhos de disco, e responde 404 para o de outro", async () => {
      const mine = (await api("GET", "/creator/submissions", { wallet: A })).json;
      assert.ok(mine.length >= 3);
      assert.ok(mine.every((s: any) => /^[0-9a-f]{24}$/.test(s.id) && !("zipPath" in s) && !("manifest" in s)));
      assert.ok(!JSON.stringify(mine).includes(root.replace(/\\/g, "\\\\")), "nenhum caminho de disco");
      const one = (await api("GET", `/creator/submissions/${mine[0].id}`, { wallet: A })).json;
      assert.equal(one.id, mine[0].id);
      assert.equal((await api("GET", `/creator/submissions/${mine[0].id}`, { wallet: B })).status, 404);
      assert.equal((await api("GET", `/creator/submissions/${mine[0].id}`)).status, 401);
      assert.equal((await api("GET", `/creator/submissions/..%2f..%2fetc`, { wallet: A })).status, 404);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("revisão do admin", () => {
    let pending: string; // submissão em pending_review

    before(async () => {
      pending = (await upload(A, files((f) => editManifest(f, (m) => ((m.slug = `${P}-revisao`), (m.version = "2.0.0"), (m.versions = [{ version: "2.0.0", releasedAt: "2026-10-02", notes: "v2" }])))))).json.id;
      assert.equal((await work(pending)).out, "pending_review");
    });

    it("só admin (ADMIN_WALLETS) acessa: 401 sem login, 403 para qualquer outro, em todas as rotas", async () => {
      const calls: [string, string][] = [
        ["GET", "/admin/submissions"],
        ["GET", `/admin/submissions/${pending}`],
        ["GET", `/admin/submissions/${pending}/file?path=manifest.json`],
        ["GET", `/admin/submissions/${pending}/knowledge-search?q=limite`],
        ["POST", `/admin/submissions/${pending}/approve`],
        ["POST", `/admin/submissions/${pending}/request-changes`],
        ["POST", `/admin/submissions/${pending}/reject`],
      ];
      for (const [m, p] of calls) {
        assert.equal((await api(m, p, { body: { notes: "ok ok", checklist: CHECK } })).status, 401, `${m} ${p} sem login`);
        for (const w of [A, NEWBIE]) assert.equal((await api(m, p, { wallet: w, body: { notes: "ok ok", checklist: CHECK } })).status, 403, `${m} ${p} como ${w}`);
      }
      assert.equal((await row(pending)).status, "pending_review", "nada mudou");
    });

    it("fila filtrada por status e prévia completa com a forma do contrato compartilhado", async () => {
      const list = (await api("GET", "/admin/submissions?status=pending_review", { wallet: ADMIN })).json;
      const mine = list.find((r: any) => r.id === pending);
      assert.ok(mine);
      assert.deepEqual([mine.slug, mine.version, mine.status, mine.isNewAgent, mine.creatorWallet, mine.creatorName], [`${P}-revisao`, "2.0.0", "pending_review", true, A, "Criadora A"]);
      assert.ok(list.every((r: any) => r.status === "pending_review"));
      assert.equal((await api("GET", "/admin/submissions?status=bogus", { wallet: ADMIN })).status, 400);

      const d = await api("GET", `/admin/submissions/${pending}`, { wallet: ADMIN });
      assert.equal(d.status, 200);
      assert.equal(d.headers.get("x-content-type-options"), "nosniff");
      assert.equal(d.headers.get("cache-control"), "no-store");
      assert.match(d.headers.get("content-type") ?? "", /^application\/json/);
      const detail = AdminSubmissionDetail.parse(d.json);
      assert.equal(detail.creator.wallet, A);
      assert.equal(detail.manifest?.slug, `${P}-revisao`);
      assert.ok(detail.files.some((f) => f.path === "manifest.json" && f.diff === "added"));
      assert.deepEqual([detail.knowledge.ingest, detail.knowledge.files >= 2], ["done", true]);
      assert.deepEqual(detail.differentiators.declared.sort(), ["escalation", "liveData", "memory"]);
      assert.ok(detail.scans && "report" in detail.scans);
      assert.ok(!JSON.stringify(d.json).includes(root.replace(/\\/g, "\\\\")), "nenhum caminho de disco");
    });

    it("arquivo do pacote sai como JSON de texto; caminho com .., absoluto ou inexistente não passa", async () => {
      const ok = await api("GET", `/admin/submissions/${pending}/file?path=steps/01-levantar.md`, { wallet: ADMIN });
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get("content-type") ?? "", /^application\/json/);
      assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Object.keys(ok.json).sort(), ["content", "path"]);
      assert.match(ok.json.content, /## Objetivo/);
      for (const bad of ["../../etc/passwd", "..%2f..%2fsegredo", "%2Fetc%2Fpasswd", "steps/../../x", "steps%5C..%5Cx", ""]) {
        const r = await api("GET", `/admin/submissions/${pending}/file?path=${bad}`, { wallet: ADMIN });
        assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
      }
      assert.equal((await api("GET", `/admin/submissions/${pending}/file?path=steps/nao-existe.md`, { wallet: ADMIN })).status, 404);
      assert.equal((await api("GET", `/admin/submissions/${pending}/file`, { wallet: ADMIN })).status, 400);
    });

    it("conteúdo malicioso do criador sai escapado como dado: o JSON é o mesmo texto, nunca HTML", async () => {
      const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
      const w = `${P}-xss`;
      await db.insert(schema.creators).values({ id: `${P}-cx`, wallet: w, name: evil, bio: evil + " bio", invited: true, termsAcceptedAt: new Date() });
      const r = await upload(w, files((f) => editManifest(f, (m) => ((m.slug = `${P}-xss-solver`), (m.name = `Nome ${evil}`.slice(0, 30)), (f["README.md"] = evil)))));
      await work(r.json.id);
      const file = await api("GET", `/admin/submissions/${r.json.id}/file?path=README.md`, { wallet: ADMIN });
      assert.match(file.headers.get("content-type") ?? "", /^application\/json/);
      assert.equal(file.json.content, evil);
      const detail = await api("GET", `/admin/submissions/${r.json.id}`, { wallet: ADMIN });
      assert.match(detail.headers.get("content-type") ?? "", /^application\/json/);
      assert.equal(detail.headers.get("x-content-type-options"), "nosniff");
    });

    it("busca de teste no conhecimento em staging", async () => {
      const hit = await api("GET", `/admin/submissions/${pending}/knowledge-search?q=${encodeURIComponent("Valores do DAS-MEI")}`, { wallet: ADMIN });
      assert.equal(hit.status, 200);
      assert.ok(hit.json.hits.length > 0 && typeof hit.json.hits[0].content === "string");
      assert.equal((await api("GET", `/admin/submissions/${pending}/knowledge-search?q=ab`, { wallet: ADMIN })).status, 400);
      assert.equal((await api("GET", `/admin/submissions/${pending}/knowledge-search`, { wallet: ADMIN })).status, 400);
    });

    it("decisões exigem motivo; aprovar exige o checklist inteiro", async () => {
      for (const action of ["approve", "request-changes", "reject"]) {
        assert.equal((await api("POST", `/admin/submissions/${pending}/${action}`, { wallet: ADMIN, body: { checklist: CHECK } })).status, 400, `${action} sem notas`);
        assert.equal((await api("POST", `/admin/submissions/${pending}/${action}`, { wallet: ADMIN, body: { notes: "  ", checklist: CHECK } })).status, 400, `${action} com notas em branco`);
      }
      const half = await api("POST", `/admin/submissions/${pending}/approve`, { wallet: ADMIN, body: { notes: "parece bom", checklist: { ...CHECK, noHarmfulInstructions: false } } });
      assert.deepEqual([half.status, half.json.code], [400, "checklist_incomplete"]);
      assert.equal((await api("POST", `/admin/submissions/${pending}/approve`, { wallet: ADMIN, body: { notes: "parece bom" } })).json.code, "checklist_incomplete");
      assert.equal((await row(pending)).status, "pending_review");
      assert.equal((await db.select().from(schema.agentPublishedVersions).where(eq(schema.agentPublishedVersions.agentId, (await row(pending)).agentId))).length, 0, "nada gravado");
    });

    it("pedir mudanças volta o envio ao criador, que reenvia o ZIP na MESMA submissão", async () => {
      const first = (await upload(A, files((f) => editManifest(f, (m) => (m.slug = `${P}-mudar`))))).json.id;
      await work(first);
      const rc = await api("POST", `/admin/submissions/${first}/request-changes`, { wallet: ADMIN, body: { notes: "Ajuste o preço e a descrição", checklist: {} } });
      assert.deepEqual([rc.status, rc.json.status], [200, "changes_requested"]);
      const s = await row(first);
      assert.deepEqual([s.status, s.reviewerNotes], ["changes_requested", "Ajuste o preço e a descrição"]);
      const view = (await api("GET", `/creator/submissions/${first}`, { wallet: A })).json;
      assert.deepEqual([view.status, view.nextAction, view.reviewerNotes], ["changes_requested", "fix_and_resubmit", "Ajuste o preço e a descrição"]);

      // Estados em que o reenvio não vale.
      assert.equal((await upload(A, files(), `?resubmit=${pending}`)).json.code, "not_resubmittable");
      assert.equal((await upload(B, files(), `?resubmit=${first}`)).status, 404, "o de outro criador");
      assert.equal((await upload(A, files(), `?resubmit=zzz`)).status, 400);
      assert.equal((await upload(A, files(), `?resubmit=${"0".repeat(24)}`)).status, 404);

      const again = await upload(A, files((f) => editManifest(f, (m) => ((m.slug = `${P}-mudar`), (m.description = String(m.description) + " Atualizada.")))), `?resubmit=${first}`);
      assert.deepEqual([again.status, again.json.id, again.json.status], [202, first, "validating"]);
      const r = await row(first);
      assert.deepEqual([r.status, r.manifest, r.validation, r.scans], ["validating", null, null, null]);
      assert.equal((await work(first)).out, "pending_review", "mesma submissão, mesma versão");
      assert.match(JSON.stringify((await row(first)).manifest), /Atualizada/);
      assert.equal((await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.slug, `${P}-mudar`))).length, 1, "não criou outra submissão");
    });

    it("recusar é definitivo: não reenvia e não aprova", async () => {
      const id = (await upload(B, files((f) => editManifest(f, (m) => (m.slug = `${P}-recusado`))))).json.id;
      await work(id);
      const rj = await api("POST", `/admin/submissions/${id}/reject`, { wallet: ADMIN, body: { notes: "Conteúdo copiado de terceiros", checklist: {} } });
      assert.deepEqual([rj.status, rj.json.status], [200, "rejected"]);
      assert.equal((await db.select().from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.version, `staging:${id}`))).length, 0, "staging descartado");
      for (const action of ["approve", "request-changes", "reject"]) {
        const r = await api("POST", `/admin/submissions/${id}/${action}`, { wallet: ADMIN, body: { notes: "de novo", checklist: CHECK } });
        assert.deepEqual([r.status, r.json.code], [409, "invalid_state"], action);
      }
      assert.equal((await upload(B, files(), `?resubmit=${id}`)).json.code, "not_resubmittable");
    });

    it("aprovar grava a versão aprovada ANTES de qualquer outra coisa e deixa a trilha de auditoria", async () => {
      const s = await row(pending);
      const steps: string[] = [];
      const out = await review.approveSubmission(
        { id: pending, reviewerWallet: ADMIN, ip: "203.0.113.9", input: { notes: "Revisei tudo: ok", checklist: CHECK } },
        { ...review.defaultReviewDeps, notifyCreator: async () => undefined, minPriceUnits: async () => 5_000_000n, trace: (st) => steps.push(st) },
      );
      assert.deepEqual(steps, ["published_version", "submission", "review"], "agent_published_versions primeiro");
      assert.equal(out.status, "awaiting_creator_signature");

      const expectedHash = hashOf(folderInput(join(root, pending, "extracted")));
      const [pv] = await db.select().from(schema.agentPublishedVersions).where(eq(schema.agentPublishedVersions.agentId, s.agentId));
      assert.deepEqual([pv!.version, pv!.versionHash, pv!.priceUsdc], ["2.0.0", expectedHash, 9_000_000n]);
      const after = await row(pending);
      assert.equal(after.status, "awaiting_creator_signature");
      assert.deepEqual(after.approved, { versionHash: expectedHash, priceUsdc: "9000000", royaltyBps: 0, name: "Fechamento do MEI", version: "2.0.0" });
      const [rv] = await db.select().from(schema.packageReviews).where(eq(schema.packageReviews.submissionId, pending));
      assert.deepEqual([rv!.action, rv!.reviewerWallet, rv!.versionHash, rv!.ip, rv!.notes], ["approve", ADMIN, expectedHash, "203.0.113.9", "Revisei tudo: ok"]);
      assert.deepEqual(rv!.checklist, CHECK);
      assert.ok(rv!.diffSnapshot && Array.isArray((rv!.diffSnapshot as any).files), "snapshot do diff");

      const view = (await api("GET", `/creator/submissions/${pending}`, { wallet: A })).json;
      assert.deepEqual([view.status, view.nextAction], ["awaiting_creator_signature", "sign_register"]);
      // A aprovação não se repete.
      const twice = await api("POST", `/admin/submissions/${pending}/approve`, { wallet: ADMIN, body: { notes: "de novo", checklist: CHECK } });
      assert.deepEqual([twice.status, twice.json.code], [409, "invalid_state"]);
    });

    it("duas aprovações simultâneas: só uma passa", async () => {
      const id = (await upload(B, files((f) => editManifest(f, (m) => (m.slug = `${P}-corrida2`))))).json.id;
      await work(id);
      const body = { notes: "ok pela corrida", checklist: CHECK };
      const rs = await Promise.all([api("POST", `/admin/submissions/${id}/approve`, { wallet: ADMIN, body }), api("POST", `/admin/submissions/${id}/approve`, { wallet: ADMIN, body })]);
      assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await db.select().from(schema.packageReviews).where(eq(schema.packageReviews.submissionId, id))).length, 1);
    });

    it("aprovar com o preço da cadeia acima do manifesto é recusado e não grava nada", async () => {
      const id = (await upload(B, files((f) => editManifest(f, (m) => (m.slug = `${P}-caro`))))).json.id;
      await work(id);
      await assert.rejects(
        review.approveSubmission({ id, reviewerWallet: ADMIN, ip: undefined, input: { notes: "ok pelo preço", checklist: CHECK } }, { ...review.defaultReviewDeps, notifyCreator: async () => undefined, minPriceUnits: async () => 20_000_000n }),
        (e: any) => e.status === 400 && e.code === "price_below_min",
      );
      assert.equal((await row(id)).status, "pending_review");
      assert.equal((await db.select().from(schema.agentPublishedVersions).where(eq(schema.agentPublishedVersions.agentId, (await row(id)).agentId))).length, 0);
    });

    it("package_reviews é somente-inserção: UPDATE e DELETE falham no banco", async () => {
      await assert.rejects(pool.query("update package_reviews set notes = 'adulterado' where submission_id = $1", [pending]), /somente-inserção/);
      await assert.rejects(pool.query("delete from package_reviews where submission_id = $1", [pending]), /somente-inserção/);
      const [rv] = await db.select().from(schema.packageReviews).where(eq(schema.packageReviews.submissionId, pending));
      assert.equal(rv!.notes, "Revisei tudo: ok");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("schema do manifesto", () => {
    it("GET /spec/manifest.schema.json é público e devolve o JSON Schema do cli:schema", async () => {
      const r = await api("GET", "/spec/manifest.schema.json");
      assert.equal(r.status, 200);
      assert.ok(r.json.title && r.json.definitions?.SolverManifestV1);
    });
  });
});


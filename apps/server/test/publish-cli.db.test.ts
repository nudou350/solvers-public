import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

// cli:publish --no-chain (Solvers da plataforma: só o banco) e a escolha de pacotes por modo (PACKAGE_SPEC.md 15 e 19), contra
// um Postgres real. Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado); veja platform-status.db.test.ts.
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (agente da plataforma de teste e prefixo "pubcli").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "pubcli";
// O Solver da plataforma de verdade (PLATFORM_AGENTS): o teste publica uma cópia dele numa pasta temporária.
const PLATFORM_ID = "c71ad0a50f750e75c71ad0a50f750e75";
const PLATFORM_SLUG = "criador-de-solvers";

describe("cli:publish com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let d: typeof import("drizzle-orm");
  let mod: typeof import("../src/cli/publish.js");
  let loadPackage: typeof import("../src/runtime/packages.js").loadPackage;
  const root = mkdtempSync(join(tmpdir(), "solvers-pubcli-"));

  function writePackage(slug: string, id: string, version: string, extra: Record<string, unknown> = {}) {
    const dir = join(root, `${slug}-${version}`, slug);
    mkdirSync(join(dir, "steps"), { recursive: true });
    mkdirSync(join(dir, "knowledge"), { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id,
        slug,
        name: "Criador de Solvers (teste)",
        tagline: "Ajuda a montar o pacote",
        description: "Solver da plataforma, gratuito",
        category: "Outros",
        version,
        creator: { id: `${PREFIX}-platform`, name: "Equipe Solvers", bio: "Plataforma" },
        requirements: [],
        packageContents: ["guia"],
        steps: [{ file: "steps/01-guia.md", gate: [] }],
        pricing: { priceUsdc: 0, royaltyBps: 0 },
        guarantee: { available: false, defaultCriteria: [] },
        ...extra,
      }),
    );
    writeFileSync(join(dir, "steps", "01-guia.md"), "# Guia\n\nMonte o pacote.");
    writeFileSync(join(dir, "knowledge", "a.md"), `Conhecimento ${version}.`);
    return dir;
  }

  async function cleanup() {
    await db.delete(schema.agentPublishedVersions).where(d.eq(schema.agentPublishedVersions.agentId, PLATFORM_ID));
    await db.delete(schema.knowledgeChunks).where(d.eq(schema.knowledgeChunks.agentId, PLATFORM_ID));
    await db.delete(schema.agentSearchVectors).where(d.eq(schema.agentSearchVectors.agentId, PLATFORM_ID));
    await db.delete(schema.agents).where(d.eq(schema.agents.id, PLATFORM_ID));
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
      SEARCH_MODE: "fts",
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    d = await import("drizzle-orm");
    mod = await import("../src/cli/publish.js");
    ({ loadPackage } = await import("../src/runtime/packages.js"));
    await cleanup();
    // O perfil do criador da plataforma já existe (com a carteira dele): o `--no-chain` não precisa de chave nem de RPC.
    await db.insert(schema.creators).values({ id: `${PREFIX}-platform`, wallet: `${PREFIX}-platform-wallet`, name: "Equipe Solvers", invited: true });
  });

  after(async () => {
    rmSync(root, { recursive: true, force: true });
    if (!db) return;
    await cleanup();
    await pool.end();
  });

  it("--no-chain: só linha no banco, ativo, preço 0, listado, sem conta on-chain, com a versão registrada como aprovada", async () => {
    const pkg = loadPackage(writePackage(PLATFORM_SLUG, PLATFORM_ID, "1.0.0"));
    await mod.publishNoChain(pkg);
    const [a] = await db.select().from(schema.agents).where(d.eq(schema.agents.id, PLATFORM_ID));
    assert.equal(a!.slug, PLATFORM_SLUG);
    assert.equal(a!.status, "active");
    assert.equal(a!.price, 0n);
    assert.equal(a!.platformStatus, "active");
    assert.equal(a!.syncFlag, "ok");
    assert.equal(a!.listed, true);
    assert.equal(a!.onchainAddress, null);
    assert.equal(a!.versionHash, pkg.versionHash);
    assert.equal(a!.creatorId, `${PREFIX}-platform`);
    const [pv] = await db.select().from(schema.agentPublishedVersions).where(d.eq(schema.agentPublishedVersions.agentId, PLATFORM_ID));
    assert.deepEqual({ version: pv!.version, price: pv!.priceUsdc, hash: pv!.versionHash }, { version: "1.0.0", price: 0n, hash: pkg.versionHash });
    const chunks = await db.select().from(schema.knowledgeChunks).where(d.eq(schema.knowledgeChunks.agentId, PLATFORM_ID));
    assert.deepEqual(chunks.map((c) => [c.version, c.content]), [["1.0.0", "Conhecimento 1.0.0."]]);
  });

  it("preço do manifesto diferente de 0 é publicado como 0; republicar atualiza e NÃO levanta uma suspensão do admin", async () => {
    await db.update(schema.agents).set({ platformStatus: "suspended" }).where(d.eq(schema.agents.id, PLATFORM_ID));
    const pkg = loadPackage(writePackage(PLATFORM_SLUG, PLATFORM_ID, "1.1.0", { pricing: { priceUsdc: 9, royaltyBps: 0 } }));
    await mod.publishNoChain(pkg);
    const [a] = await db.select().from(schema.agents).where(d.eq(schema.agents.id, PLATFORM_ID));
    assert.equal(a!.version, "1.1.0");
    assert.equal(a!.price, 0n);
    assert.equal(a!.platformStatus, "suspended");
    const versions = (await db.select().from(schema.agentPublishedVersions).where(d.eq(schema.agentPublishedVersions.agentId, PLATFORM_ID))).map((v) => v.version).sort();
    assert.deepEqual(versions, ["1.0.0", "1.1.0"], "as versões antigas ficam registradas");
  });

  describe("selectPackages: cada modo pega o seu grupo", () => {
    const pk = (slug: string, id: string, source: "agents" | "published" = "agents") => ({ manifest: { slug, id }, source }) as never;
    const platform = pk(PLATFORM_SLUG, PLATFORM_ID);
    const normal = pk("frontend-react", "a".repeat(32));
    const all = [platform, normal];
    const slugs = (list: { manifest: { slug: string } }[]) => list.map((p) => p.manifest.slug);

    it("sem nomes: com cadeia só os comuns; --no-chain só os da plataforma", () => {
      assert.deepEqual(slugs(mod.selectPackages(all, [], {})), ["frontend-react"]);
      assert.deepEqual(slugs(mod.selectPackages(all, [], { noChain: true })), [PLATFORM_SLUG]);
    });

    it("com nomes: o modo errado é recusado com o motivo, e nome desconhecido também", () => {
      assert.deepEqual(slugs(mod.selectPackages(all, ["frontend-react"], {})), ["frontend-react"]);
      assert.deepEqual(slugs(mod.selectPackages(all, [PLATFORM_ID], { noChain: true })), [PLATFORM_SLUG], "também pelo id");
      assert.throws(() => mod.selectPackages(all, [PLATFORM_SLUG], {}), /--no-chain/);
      assert.throws(() => mod.selectPackages(all, ["frontend-react"], { noChain: true }), /PLATFORM_AGENTS/);
      assert.throws(() => mod.selectPackages(all, ["nao-existe"], {}), /pacotes de criadores publicam pelo site/);
    });

    it("os pacotes reais de agents/: o cli:publish de sempre pega os que tinha (menos o da plataforma, que vai com --no-chain)", async () => {
      const { packages } = await import("../src/runtime/packages.js");
      const real = [...new Map([...packages().values()].map((p) => [p.manifest.id, p])).values()].filter((p) => (p.source ?? "agents") === "agents");
      const onchain = slugs(mod.selectPackages(real, [], {}));
      assert.ok(onchain.length >= 6, `esperava os pacotes de agents/ (achei ${onchain.join(", ")})`);
      assert.ok(!onchain.includes(PLATFORM_SLUG));
      assert.ok(onchain.includes("frontend-react") && onchain.includes("ui-design"));
      for (const s of slugs(mod.selectPackages(real, [], { noChain: true }))) assert.equal(s, PLATFORM_SLUG);
    });
  });
});

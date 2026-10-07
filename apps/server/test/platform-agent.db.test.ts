import { strict as assert } from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

// Solver da plataforma (Criador de Solvers) contra um Postgres real: acesso gratuito sem licença nem teste, templates,
// ferramenta validate_package pelo conector MCP, compra/garantia bloqueadas e fora dos lotes de uso on-chain.
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (o agente usa o id real da plataforma; creators prefixo "platest").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "platest";
const PLATFORM_ID = "c71ad0a50f750e75c71ad0a50f750e75";
const SLUG = "criador-de-solvers";

/** Keypair descartável no formato JSON da Solana CLI (o initChain do servidor precisa de chaves válidas, mesmo sem rede). */
function fakeKeypair(): string {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  return JSON.stringify([...Buffer.from(jwk.d!, "base64url"), ...Buffer.from(jwk.x!, "base64url")]);
}

const STEP = (n: number) => `# Etapa ${n}\n\n## Objetivo\nFazer a etapa ${n}.\n\n## Como executar\n1. Faça.\n\n## Formato do result_summary\nUma linha.\n`;

const manifest = {
  specVersion: 1,
  id: PLATFORM_ID,
  slug: SLUG,
  name: "Criador de Solvers",
  tagline: "Monta o seu Solver passo a passo",
  description: "Solver gratuito da plataforma usado nos testes do servidor.",
  category: "Outros",
  version: "1.0.0",
  platform: true,
  creator: { id: "solvers", name: "Solvers", bio: "Plataforma" },
  terms: { rightsConfirmed: true, sourcesListed: true },
  requirements: [],
  packageContents: ["a", "b", "c"],
  steps: [
    { file: "steps/01-um.md", gate: ["Feito"] },
    { file: "steps/02-dois.md", gate: ["Feito"] },
  ],
  tools: [{ name: "validate_package", description: "Valida o manifesto e as etapas", runner: "builtin:validate-package", inputSchema: { type: "object" } }],
  templates: [
    { name: "briefing", path: "templates/briefing.md", title: "Briefing", description: "Modelo do briefing" },
    { name: "caso", path: "templates/caso.json", title: "Caso de eval", description: "Esqueleto de um caso" },
    { name: "logo", path: "templates/logo.svg", title: "Logo", description: "Imagem (nunca entregue)" },
  ],
  pricing: { priceUsdc: 5, royaltyBps: 0 },
  guarantee: { available: false, defaultCriteria: [] },
  versions: [{ version: "1.0.0", releasedAt: "2026-10-01", notes: "n" }],
};

describe("Solver da plataforma com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let drizzle: typeof import("drizzle-orm");
  let access: typeof import("../src/runtime/access.js");
  let getPackage: typeof import("../src/runtime/packages.js").getPackage;
  let findAgentRow: typeof import("../src/store/catalog.js").findAgentRow;
  let signSession: typeof import("../src/auth/jwt.js").signSession;
  let server: Server;
  let base = "";
  let tmp = "";
  const clients: { close: () => Promise<void> }[] = [];

  /** Conector MCP em memória, falando como a carteira dada (mesmas ferramentas do /mcp). */
  async function connect(wallet: string, isAgent = false) {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { buildMcpServer } = await import("../src/mcp/tools.js");
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await buildMcpServer({ wallet, isAgent }).connect(st);
    const client = new Client({ name: "teste", version: "1" });
    await client.connect(ct);
    clients.push(client);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content[0]!.text, isError: r.isError === true };
    };
    return { client, call };
  }

  async function cleanup() {
    const { eq, like } = drizzle;
    await db.delete(schema.usageEvents).where(eq(schema.usageEvents.agentId, PLATFORM_ID));
    await db.delete(schema.sessions).where(eq(schema.sessions.agentId, PLATFORM_ID));
    await db.delete(schema.trials).where(eq(schema.trials.agentId, PLATFORM_ID));
    await db.delete(schema.licenses).where(eq(schema.licenses.agentId, PLATFORM_ID));
    await db.delete(schema.agents).where(eq(schema.agents.id, PLATFORM_ID));
    await db.delete(schema.creators).where(like(schema.creators.id, `${PREFIX}%`));
  }

  before(async () => {
    // Pacote da plataforma só para este teste (AGENTS_DIR aponta para ele; o pacote real do repositório não é tocado).
    tmp = mkdtempSync(join(tmpdir(), "solvers-platform-"));
    const dir = join(tmp, "agents", SLUG);
    mkdirSync(join(dir, "steps"), { recursive: true });
    mkdirSync(join(dir, "templates"), { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "steps", "01-um.md"), STEP(1));
    writeFileSync(join(dir, "steps", "02-dois.md"), STEP(2));
    writeFileSync(join(dir, "templates", "briefing.md"), "# Briefing\n\nPreencha o público.\n");
    writeFileSync(join(dir, "templates", "caso.json"), '{ "id": "caso-1", "input": "pedido", "checks": [] }\n');
    writeFileSync(join(dir, "templates", "logo.svg"), "<svg onload=alert(1)></svg>");

    Object.assign(process.env, {
      DATABASE_URL: url,
      AGENTS_DIR: join(tmp, "agents"),
      PUBLISHED_DIR: join(tmp, "nao-existe"),
      SOLANA_RPC_URL: "http://127.0.0.1:1", // porta fechada: falha rápido, nada sai do PC
      USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      FEE_PAYER_KEYPAIR: fakeKeypair(),
      VERIFIER_KEYPAIR: fakeKeypair(),
      USAGE_AUTHORITY_KEYPAIR: fakeKeypair(),
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    drizzle = await import("drizzle-orm");
    access = await import("../src/runtime/access.js");
    ({ getPackage } = await import("../src/runtime/packages.js"));
    ({ findAgentRow } = await import("../src/store/catalog.js"));
    ({ signSession } = await import("../src/auth/jwt.js"));
    await (await import("../src/chain/index.js")).initChain();
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");

    await cleanup();
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: (await generateKeyPairSigner()).address, name: "Plataforma" });
    // Só no banco: sem onchain_address nem collection_address (não há conta on-chain).
    await db.insert(schema.agents).values({
      id: PLATFORM_ID, slug: SLUG, name: "Criador de Solvers", tagline: "Monta o seu Solver passo a passo", description: "d", category: "Outros",
      creatorId: `${PREFIX}-creator`, version: "1.0.0", versionHash: "ab".repeat(32), price: 5_000_000n, status: "active", listed: true,
    });
    await new Promise<void>((resolve) => {
      server = createApp(mounts).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
    server?.close();
    if (db) {
      await cleanup();
      await pool.end();
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("o pacote da plataforma carrega pelo AGENTS_DIR e vale como platform", () => {
    const pkg = getPackage(PLATFORM_ID)!;
    assert.equal(pkg.platform, true);
    assert.equal(pkg.source, "agents");
    assert.equal(pkg.manifest.templates?.length, 3);
  });

  it("resolveAccess: qualquer carteira logada, sem teste e sem consumir nada (nem para agente)", async () => {
    const wallet = (await generateKeyPairSigner()).address;
    const row = await findAgentRow(PLATFORM_ID);
    const pkg = getPackage(PLATFORM_ID)!;
    for (const agent of [false, true]) {
      const a = await access.resolveAccess(wallet, row, pkg, { consume: true, allowTrial: true, agent });
      assert.deepEqual(a, { ok: true, kind: "platform" });
    }
    const trials = await db.select().from(schema.trials).where(drizzle.eq(schema.trials.wallet, wallet));
    assert.equal(trials.length, 0, "nenhum uso de teste foi gasto");
    // Mesmo aposentado (paid_only) o acesso platform vale; o teste não.
    const retired = { ...row, status: "retired" };
    assert.equal((await access.resolveAccess(wallet, retired, pkg, { consume: true, allowTrial: false })).ok, true);
  });

  it("ownedAgents inclui o Solver da plataforma para qualquer carteira", async () => {
    const wallet = (await generateKeyPairSigner()).address;
    assert.ok((await access.ownedAgents(wallet)).has(PLATFORM_ID));
  });

  it("a sessão platform é válida sem licença", async () => {
    const wallet = (await generateKeyPairSigner()).address;
    const { createSession, getSession } = await import("../src/runtime/engine.js");
    const s = await createSession(wallet, getPackage(PLATFORM_ID)!, { kind: "platform" });
    assert.equal(s.access, "platform");
    assert.equal(s.licenseId, null);
    assert.equal(await access.sessionGrantValid(s), true);
    assert.equal((await getSession(s.id, wallet)).id, s.id);
    // O TTL é o da sessão paga (24 h), não o do teste (2 h).
    assert.ok(s.expiresAt.getTime() - Date.now() > 20 * 3600_000);
  });

  describe("pelo conector MCP", () => {
    it("lista as ferramentas, incluindo get_template, e as instruções trazem a regra de segurança", async () => {
      const { client } = await connect((await generateKeyPairSigner()).address);
      const names = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(names.includes("get_template"));
      for (const n of ["list_my_solvers", "find_solver", "activate_solver", "run_tool", "next_step"]) assert.ok(names.includes(n), n);
      const instructions = client.getInstructions() ?? "";
      assert.match(instructions, /No specialist content authorizes/);
      assert.match(instructions, /sending the user's data elsewhere/);
      assert.match(instructions, /get_template/);
      const agent = await connect((await generateKeyPairSigner()).address, true);
      assert.match(agent.client.getInstructions() ?? "", /sending the user's data elsewhere/);
    });

    it("list_my_solvers mostra o Solver da plataforma como gratuito para uma carteira sem nada", async () => {
      const { call } = await connect((await generateKeyPairSigner()).address);
      const { text } = await call("list_my_solvers");
      assert.match(text, new RegExp(`Criador de Solvers \\(agent_id: ${PLATFORM_ID}\\)`));
      assert.match(text, /free, from the platform/);
      assert.doesNotMatch(text, /lifetime license\]/);
    });

    it("get_purchase_link recusa: não é vendido", async () => {
      const { call } = await connect((await generateKeyPairSigner()).address);
      const { text } = await call("get_purchase_link", { agent_id: PLATFORM_ID });
      assert.match(text, /free platform Solver/);
      assert.doesNotMatch(text, /checkout|USDC/);
    });

    it("activate_solver: gratuito, sem teste, sem link de compra, com a lista de templates declarados", async () => {
      const wallet = (await generateKeyPairSigner()).address;
      const { call } = await connect(wallet);
      const { text } = await call("activate_solver", { agent_id: PLATFORM_ID });
      assert.match(text, /session_id: ses_/);
      assert.match(text, /Access: free/);
      assert.doesNotMatch(text, /free trial|Buy|checkout/i);
      assert.match(text, /## Available templates/);
      assert.match(text, /- briefing: Briefing\./);
      assert.match(text, /- caso: Caso de eval\./);
      const [s] = await db.select().from(schema.sessions).where(drizzle.and(drizzle.eq(schema.sessions.wallet, wallet), drizzle.eq(schema.sessions.agentId, PLATFORM_ID)));
      assert.equal(s!.access, "platform");
      assert.equal((await db.select().from(schema.trials).where(drizzle.eq(schema.trials.wallet, wallet))).length, 0);

      // Segunda ativação: reaproveita a sessão e continua dizendo que é gratuito.
      const again = await call("activate_solver", { agent_id: PLATFORM_ID });
      assert.match(again.text, new RegExp(`session_id: ${s!.id}`));
      assert.match(again.text, /Access: free/);
    });

    it("get_template: só o declarado, texto, com marca d'água; svg, nome inventado e caminho nunca saem", async () => {
      const wallet = (await generateKeyPairSigner()).address;
      const { call } = await connect(wallet);
      const sid = /session_id: (ses_\w+)/.exec((await call("activate_solver", { agent_id: PLATFORM_ID })).text)![1]!;

      const md = await call("get_template", { session_id: sid, name: "briefing" });
      assert.equal(md.isError, false);
      assert.match(md.text, /# Template: Briefing \(briefing\)/);
      assert.match(md.text, /Preencha o público\./);
      const { watermark } = await import("../src/runtime/engine.js");
      assert.ok(md.text.endsWith(watermark(wallet, PLATFORM_ID)), "marca d'água por carteira no fim");

      const json = await call("get_template", { session_id: sid, name: "caso" });
      assert.ok(json.text.includes('```json\n{ "id": "caso-1", "input": "pedido", "checks": [] }\n```'));

      for (const name of ["logo", "nao-existe", "../../manifest", "templates/briefing.md", "steps/01-um.md"]) {
        const r = await call("get_template", { session_id: sid, name });
        assert.doesNotMatch(r.text, /<svg|Preencha|# Etapa/, name);
      }
      assert.match((await call("get_template", { session_id: sid, name: "logo" })).text, /not a text file/);
      assert.match((await call("get_template", { session_id: sid, name: "nao-existe" })).text, /There is no template "nao-existe".*Available: briefing, caso, logo/);
    });

    it("get_template exige sessão da própria carteira", async () => {
      const dono = (await generateKeyPairSigner()).address;
      const sid = /session_id: (ses_\w+)/.exec((await (await connect(dono)).call("activate_solver", { agent_id: PLATFORM_ID })).text)![1]!;
      const outro = await connect((await generateKeyPairSigner()).address);
      const r = await outro.call("get_template", { session_id: sid, name: "briefing" });
      assert.equal(r.isError, true);
      assert.match(r.text, /another wallet/);
    });

    it("run_tool validate_package: valida o manifesto e as etapas e devolve { ok, errors, warnings, stats, summary }", async () => {
      const { call } = await connect((await generateKeyPairSigner()).address);
      const sid = /session_id: (ses_\w+)/.exec((await call("activate_solver", { agent_id: PLATFORM_ID })).text)![1]!;
      const bad = await call("run_tool", { session_id: sid, tool: "validate_package", input: { manifest: { slug: "x" }, steps: [] } });
      assert.equal(bad.isError, false);
      const out = JSON.parse(bad.text) as { ok: boolean; errors: { code: string; path: string; message: string; fix: string }[]; summary: string; stats: unknown; warnings: unknown[] };
      assert.equal(out.ok, false);
      assert.ok(out.errors.length > 0);
      assert.ok(out.errors.every((e) => e.code && e.message && e.fix && typeof e.path === "string"));
      assert.match(out.summary, /errors to fix/);
      assert.ok(out.stats && Array.isArray(out.warnings));
      // Entrada fora do contrato: erro claro, sem derrubar nada.
      const wrong = await call("run_tool", { session_id: sid, tool: "validate_package", input: { nada: 1 } });
      assert.equal(wrong.isError, true);
      assert.match(wrong.text, /Invalid input/);
    });

    it("next_step segue o método normalmente na sessão platform", async () => {
      const { call } = await connect((await generateKeyPairSigner()).address);
      const sid = /session_id: (ses_\w+)/.exec((await call("activate_solver", { agent_id: PLATFORM_ID })).text)![1]!;
      assert.match((await call("preflight_check", { session_id: sid, available_tools: [] })).text, /All set/);
      assert.match((await call("next_step", { session_id: sid, completed_step: 0 })).text, /Step 1 of 2/);
    });

    it("suspender o Solver da plataforma (kill switch) derruba a sessão e a ativação", async () => {
      const { call } = await connect((await generateKeyPairSigner()).address);
      const sid = /session_id: (ses_\w+)/.exec((await call("activate_solver", { agent_id: PLATFORM_ID })).text)![1]!;
      await db.update(schema.agents).set({ platformStatus: "suspended" }).where(drizzle.eq(schema.agents.id, PLATFORM_ID));
      try {
        const r = await call("get_template", { session_id: sid, name: "briefing" });
        assert.equal(r.isError, true);
        assert.match(r.text, /unavailable/);
        assert.match((await call("activate_solver", { agent_id: PLATFORM_ID })).text, /unavailable/);
        assert.doesNotMatch((await call("list_my_solvers")).text, new RegExp(PLATFORM_ID), "suspenso não aparece na lista");
      } finally {
        await db.update(schema.agents).set({ platformStatus: "active" }).where(drizzle.eq(schema.agents.id, PLATFORM_ID));
      }
    });
  });

  describe("compra e garantia bloqueadas", () => {
    it("assertCanPurchase e assertFreshPrice respondem 409 platform_agent_not_for_sale (sem RPC)", async () => {
      const row = await findAgentRow(PLATFORM_ID);
      const { assertCanPurchase } = await import("../src/store/purchase-guards.js");
      const { assertFreshPrice } = await import("../src/store/fresh-price.js");
      const is409 = (e: unknown) => (e as { status?: number }).status === 409 && (e as { code?: string }).code === "platform_agent_not_for_sale";
      await assert.rejects(assertCanPurchase((await generateKeyPairSigner()).address, row), is409);
      await assert.rejects(assertFreshPrice(row), is409);
    });

    it("POST /api/tx/purchase e /api/tx/escrow: 409 platform_agent_not_for_sale", async () => {
      const wallet = (await generateKeyPairSigner()).address;
      const token = await signSession(wallet);
      for (const [path, body] of [
        ["/api/tx/purchase", { agentId: PLATFORM_ID, type: "permanent" }],
        ["/api/tx/purchase", { agentId: SLUG, type: "permanent" }],
        ["/api/tx/escrow", { agentId: PLATFORM_ID, title: "Minha tarefa", description: "Quero uma tarefa com garantia", deliveryDays: 7 }],
      ] as const) {
        const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
        const json = (await res.json()) as { code?: string; error?: string };
        assert.equal(res.status, 409, `${path}: ${JSON.stringify(json)}`);
        assert.equal(json.code, "platform_agent_not_for_sale");
      }
    });

    it("a vitrine marca o agente como platform e sem teste", async () => {
      const { toAgent } = await import("../src/store/mappers.js");
      const agent = toAgent(await findAgentRow(PLATFORM_ID), { trend7d: 0, resaleFloor: null });
      assert.equal(agent.platform, true);
      assert.equal(agent.trialAvailable, false);
      assert.equal(agent.guaranteeAvailable, false);
      assert.ok(Array.isArray(agent.differentiators));
    });
  });

  describe("fora do lote de usos on-chain", () => {
    it("o job não seleciona o uso do Solver da plataforma (nem tenta montar a transação)", async () => {
      const wallet = (await generateKeyPairSigner()).address;
      const sessionId = `${PREFIX}-ses-lote`;
      // Mesmo que uma sessão "trial" apareça (dado estranho), o agente da plataforma nunca entra em lote.
      await db.insert(schema.sessions).values({ id: sessionId, wallet, agentId: PLATFORM_ID, version: "1.0.0", access: "trial" });
      await db.insert(schema.usageEvents).values({ wallet, agentId: PLATFORM_ID, sessionId, tool: "activate_solver", responseHash: "ab".repeat(32), createdAt: new Date(Date.now() - 60_000) });
      const { recordUsageBatchOnce } = await import("../src/jobs.js");
      const errors: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
      try {
        await recordUsageBatchOnce().catch(() => 0);
      } finally {
        console.error = original;
      }
      assert.ok(!errors.some((e) => e.includes(PLATFORM_ID)), `o job tentou montar lote do agente da plataforma: ${errors.join(" | ")}`);
      const [ev] = await db.select().from(schema.usageEvents).where(drizzle.eq(schema.usageEvents.sessionId, sessionId));
      assert.equal(ev!.batchId, null);
      assert.equal(ev!.batched, false);
    });
  });
});

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import type * as gen from "@solvers/client";

// Kill switch e acesso à memória contra um Postgres real (PACKAGE_SPEC.md 11.2, 15.4 e P0).
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); sem ela, é pulado.
//
//   docker run -d --name solvers-test -e POSTGRES_USER=solvers -e POSTGRES_PASSWORD=solvers -e POSTGRES_DB=solvers_test \
//     -p 127.0.0.1:5543:5432 pgvector/pgvector:pg16
//   DATABASE_URL=postgres://solvers:solvers@127.0.0.1:5543/solvers_test <vars de env> npm run db:migrate
//   TEST_DATABASE_URL=postgres://solvers:solvers@127.0.0.1:5543/solvers_test npm test
//
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (prefixo "p0test").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "p0test";
const AGENT = "00000000000000000000000000p0test".slice(0, 32).replace(/[^0-9a-f]/g, "0");
const OTHER = "11111111111111111111111111111111";
const WALLET = `${PREFIX}-wallet`;

describe("kill switch e memória com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let getSession: typeof import("../src/runtime/engine.js").getSession;
  let assertMemoryAccess: typeof import("../src/mcp/tools.js").assertMemoryAccess;
  let findAgentRow: typeof import("../src/store/catalog.js").findAgentRow;
  let agentMirrorValues: typeof import("../src/indexer/mirror.js").agentMirrorValues;
  let eq: typeof import("drizzle-orm").eq;
  let like: typeof import("drizzle-orm").like;

  const agentRow = (id: string, slug: string) => ({
    id,
    slug,
    name: "Agente de teste",
    tagline: "t",
    description: "d",
    category: "Outros",
    creatorId: `${PREFIX}-creator`,
    version: "1.0.0",
    versionHash: "ab".repeat(32),
    price: 5_000_000n,
    status: "active",
    listed: true,
  });

  async function newSession(id: string, over: Record<string, unknown> = {}) {
    await db.insert(schema.sessions).values({ id, wallet: WALLET, agentId: AGENT, version: "1.0.0", access: "trial", ...over });
  }

  async function cleanup() {
    await db.delete(schema.sessions).where(like(schema.sessions.id, `${PREFIX}%`));
    await db.delete(schema.licenses).where(like(schema.licenses.id, `${PREFIX}%`));
    await db.delete(schema.agents).where(like(schema.agents.slug, `${PREFIX}%`));
    await db.delete(schema.creators).where(like(schema.creators.id, `${PREFIX}%`));
  }

  before(async () => {
    // O env do servidor exige estas variáveis; valores de mentira bastam (nada on-chain é chamado aqui).
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
    ({ getSession } = await import("../src/runtime/engine.js"));
    ({ assertMemoryAccess } = await import("../src/mcp/tools.js"));
    ({ findAgentRow } = await import("../src/store/catalog.js"));
    ({ agentMirrorValues } = await import("../src/indexer/mirror.js"));
    ({ eq, like } = await import("drizzle-orm"));
    await cleanup();
    await db.insert(schema.agents).values(agentRow(AGENT, `${PREFIX}-agente`));
    await db.insert(schema.agents).values(agentRow(OTHER, `${PREFIX}-outro`));
  });

  after(async () => {
    if (!db) return;
    await cleanup();
    await pool.end();
  });

  it("a coluna nova nasce 'active'", async () => {
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, AGENT));
    assert.equal(row!.platformStatus, "active");
  });

  it("suspender pelo banco derruba a sessão aberta, e o evento do indexador não a reativa", async () => {
    await newSession(`${PREFIX}-s1`);
    assert.equal((await getSession(`${PREFIX}-s1`, WALLET)).id, `${PREFIX}-s1`);

    await db.update(schema.agents).set({ platformStatus: "suspended" }).where(eq(schema.agents.id, AGENT));
    await assert.rejects(getSession(`${PREFIX}-s1`, WALLET), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");

    // Evento on-chain (UsageRecorded, LicensePurchased...): o indexador aplica o espelho da conta, status "active".
    const onchain = {
      version: "1.0.0", versionHash: new Uint8Array(32), price: 5_000_000n, pricePerUse: 0n, royaltyBps: 0, evalScoreBps: 0,
      evalHash: new Uint8Array(32), status: 1, totalSales: 1n, verifiedUses: 0n, ratingSum: 0n, ratingCount: 0, disputesLost: 0,
      stake: 0n, collection: "Colecao",
    } as unknown as gen.Agent;
    await db.update(schema.agents).set(agentMirrorValues(onchain, "Endereco" as never)).where(eq(schema.agents.id, AGENT));

    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, AGENT));
    assert.equal(row!.status, "active");
    assert.equal(row!.platformStatus, "suspended", "o espelho da cadeia não pode reativar o agente suspenso");
    await assert.rejects(getSession(`${PREFIX}-s1`, WALLET), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");

    await db.update(schema.agents).set({ platformStatus: "active" }).where(eq(schema.agents.id, AGENT));
    assert.equal((await getSession(`${PREFIX}-s1`, WALLET)).id, `${PREFIX}-s1`);
  });

  it("status suspenso na cadeia também derruba a sessão", async () => {
    await db.update(schema.agents).set({ status: "suspended" }).where(eq(schema.agents.id, AGENT));
    await assert.rejects(getSession(`${PREFIX}-s1`, WALLET), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");
    await db.update(schema.agents).set({ status: "active" }).where(eq(schema.agents.id, AGENT));
  });

  it("memória: sem sessão nem licença é recusada; com sessão aberta (teste) passa", async () => {
    await db.delete(schema.sessions).where(like(schema.sessions.id, `${PREFIX}%`));
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, AGENT));
    await assert.rejects(assertMemoryAccess(WALLET, row!), (e: unknown) => (e as { code?: string }).code === "memory_no_access");

    await newSession(`${PREFIX}-s2`, { access: "trial" });
    await assert.doesNotReject(assertMemoryAccess(WALLET, row!));
  });

  it("memória: sessão expirada não conta; licença conta; agente suspenso nega até com licença", async () => {
    await db.delete(schema.sessions).where(like(schema.sessions.id, `${PREFIX}%`));
    await newSession(`${PREFIX}-s3`, { expiresAt: new Date(Date.now() - 60_000) });
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, AGENT));
    await assert.rejects(assertMemoryAccess(WALLET, row!), (e: unknown) => (e as { code?: string }).code === "memory_no_access");

    await db.insert(schema.licenses).values({ id: `${PREFIX}-lic`, agentId: AGENT, ownerWallet: WALLET });
    await assert.doesNotReject(assertMemoryAccess(WALLET, row!));

    await db.update(schema.agents).set({ platformStatus: "suspended" }).where(eq(schema.agents.id, AGENT));
    const [suspended] = await db.select().from(schema.agents).where(eq(schema.agents.id, AGENT));
    await assert.rejects(assertMemoryAccess(WALLET, suspended!), (e: unknown) => (e as { code?: string }).code === "agent_unavailable");
    await db.update(schema.agents).set({ platformStatus: "active" }).where(eq(schema.agents.id, AGENT));
  });

  it("memória: licença de OUTRO agente não vale", async () => {
    const [other] = await db.select().from(schema.agents).where(eq(schema.agents.id, OTHER));
    await assert.rejects(assertMemoryAccess(WALLET, other!), (e: unknown) => (e as { code?: string }).code === "memory_no_access");
  });

  it("findAgentRow: id (32 hex) busca por id, o resto busca por slug", async () => {
    assert.equal((await findAgentRow(AGENT)).slug, `${PREFIX}-agente`);
    assert.equal((await findAgentRow(`${PREFIX}-outro`)).id, OTHER);
    await assert.rejects(findAgentRow(`${PREFIX}-nao-existe`), (e: unknown) => (e as { status?: number }).status === 404);
  });

  it("listCreators: criador só com especialistas suspensos sai da lista", async () => {
    const { listCreators } = await import("../src/store/catalog.js");
    const ids = async () => (await listCreators()).map((c) => c.id);
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: `${PREFIX}-creator-wallet`, name: "Criador de teste" });
    assert.ok((await ids()).includes(`${PREFIX}-creator`));

    await db.update(schema.agents).set({ platformStatus: "suspended" }).where(like(schema.agents.slug, `${PREFIX}%`));
    assert.ok(!(await ids()).includes(`${PREFIX}-creator`));

    await db.update(schema.agents).set({ platformStatus: "active" }).where(eq(schema.agents.id, AGENT));
    assert.ok((await ids()).includes(`${PREFIX}-creator`), "um especialista ativo basta para listar o criador");
  });
});

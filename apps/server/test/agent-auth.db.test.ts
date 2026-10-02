import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { generateKeyPairSigner, getBase58Decoder, signBytes, type KeyPairSigner } from "@solana/kit";

// Login SIWS direto do agente (/oauth/agent/*) e o que o token de agente muda no /mcp (sem teste grátis, texto de compra x402).
// Só roda com TEST_DATABASE_URL (banco DESCARTÁVEL já migrado: `db:migrate`); veja o cabeçalho de platform-status.db.test.ts.
// NUNCA aponte para o banco de dev: o teste cria e apaga linhas (prefixo "agtest").

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "agtest";
const AGENT = "0ee9927a8023c955da8d010762eb2efe"; // id real do pacote agents/frontend-react (o /mcp carrega o pacote do disco)
const SLUG = `${PREFIX}-frontend`;
const AGENT2 = "b73a0405a98f900454c7c4b809685e13"; // agents/backend-node (sem teste grátis)
const SLUG2 = `${PREFIX}-backend`;

describe("login do agente com banco", { skip: url ? false : "defina TEST_DATABASE_URL (banco descartável migrado)" }, () => {
  let db: typeof import("../src/db/index.js").db;
  let schema: typeof import("../src/db/index.js").schema;
  let pool: typeof import("../src/db/index.js").pool;
  let drizzle: typeof import("drizzle-orm");
  let createNonce: typeof import("../src/auth/siws.js").createNonce;
  let issueHuman: (wallet: string) => Promise<{ access_token: string }>;
  let server: Server;
  let base = "";

  const sign = async (s: KeyPairSigner, text: string) => getBase58Decoder().decode(await signBytes(s.keyPair.privateKey, new TextEncoder().encode(text)));
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  /** Duas chamadas do agente: nonce + token. */
  async function login(s: KeyPairSigner, over: { memory?: boolean; message?: string; signer?: KeyPairSigner } = {}) {
    const n = (await (await fetch(`${base}/oauth/agent/nonce?wallet=${s.address}`)).json()) as { message: string };
    const message = over.message ?? n.message;
    return post("/oauth/agent/token", {
      wallet: s.address,
      message,
      signature: await sign(over.signer ?? s, message),
      memorySignature: over.memory ? await sign(s, "Solvers memory key v1") : undefined,
    });
  }

  let rpcId = 0;
  async function rpc(token: string, method: string, params: unknown = {}) {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    assert.equal(res.status, 200, `${method}: ${res.status}`);
    return ((await res.json()) as { result: { content?: { text: string }[]; tools?: unknown[]; instructions?: string } }).result;
  }
  const callText = async (token: string, name: string, args: unknown) => (await rpc(token, "tools/call", { name, arguments: args })).content![0]!.text;

  async function cleanup() {
    const { like } = drizzle;
    for (const id of [AGENT, AGENT2]) {
      await db.delete(schema.trials).where(eq(schema.trials.agentId, id));
      await db.delete(schema.sessions).where(eq(schema.sessions.agentId, id));
      await db.delete(schema.usageEvents).where(eq(schema.usageEvents.agentId, id));
      await db.delete(schema.licenses).where(eq(schema.licenses.agentId, id));
    }
    await db.delete(schema.agents).where(like(schema.agents.slug, `${PREFIX}%`));
    await db.delete(schema.creators).where(like(schema.creators.id, `${PREFIX}%`));
  }
  let eq: typeof import("drizzle-orm").eq;
  let creatorWallet = "";

  before(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      SOLANA_RPC_URL: "http://127.0.0.1:1", // porta fechada: falha rápido, nada sai do PC
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
    });
    ({ db, schema, pool } = await import("../src/db/index.js"));
    drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    ({ createNonce } = await import("../src/auth/siws.js"));
    const { _issueTokensForTests } = await import("../src/oauth/routes.js");
    issueHuman = (wallet) => _issueTokensForTests("cli_agtest", wallet, null);
    await (await import("../src/chain/index.js")).initChain();
    const { createApp } = await import("../src/app.js");
    const { mounts } = await import("../src/modules.js");

    await cleanup();
    creatorWallet = (await generateKeyPairSigner()).address;
    await db.insert(schema.creators).values({ id: `${PREFIX}-creator`, wallet: creatorWallet, name: "Criador de teste" });
    await db.insert(schema.agents).values({
      id: AGENT, slug: SLUG, name: "Solver Front-end React", tagline: "t", description: "d", category: "Outros", creatorId: `${PREFIX}-creator`,
      version: "1.0.0", versionHash: "ab".repeat(32), price: 20_000_000n, status: "active", listed: true,
    });
    await db.insert(schema.agents).values({
      id: AGENT2, slug: SLUG2, name: "Solver Back-end Node", tagline: "t", description: "d", category: "Outros", creatorId: `${PREFIX}-creator`,
      version: "1.0.0", versionHash: "cd".repeat(32), price: 20_000_000n, status: "active", listed: true,
      collectionAddress: (await generateKeyPairSigner()).address,
    });
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

  it("duas chamadas dão um token que passa em initialize e tools/list", async () => {
    const w = await generateKeyPairSigner();
    const res = await login(w, { memory: true });
    assert.equal(res.status, 200);
    const tok = (await res.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
    assert.equal(tok.token_type, "Bearer");
    assert.equal(tok.scope, "solvers");
    assert.ok(tok.refresh_token);
    const init = await rpc(tok.access_token, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "agente", version: "1" } });
    assert.match(init.instructions ?? "", /agente autônomo/);
    const tools = await rpc(tok.access_token, "tools/list");
    assert.ok((tools.tools?.length ?? 0) >= 10);
    // O token é do cliente "agent" (a base do isAgent) e a chave de memória foi guardada.
    const [row] = await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.wallet, w.address));
    assert.equal(row!.clientId, "agent");
    const mk = await db.select().from(schema.memoryKeys).where(eq(schema.memoryKeys.tokenId, row!.id));
    assert.equal(mk.length, 1);
  });

  it("sem memorySignature, o token vale mas não guarda chave de memória", async () => {
    const w = await generateKeyPairSigner();
    assert.equal((await login(w)).status, 200);
    const [row] = await db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.wallet, w.address));
    assert.equal((await db.select().from(schema.memoryKeys).where(eq(schema.memoryKeys.tokenId, row!.id))).length, 0);
  });

  it("nonce de outro propósito ('login' ou 'oauth') não vale no login do agente", async () => {
    for (const purpose of ["login", "oauth"]) {
      const w = await generateKeyPairSigner();
      const n = await createNonce(w.address, purpose);
      const res = await post("/oauth/agent/token", { wallet: w.address, message: n.message, signature: await sign(w, n.message) });
      assert.equal(res.status, 401, purpose);
    }
  });

  it("e o nonce do agente não vale no login da vitrine (propósito 'login')", async () => {
    const w = await generateKeyPairSigner();
    const n = (await (await fetch(`${base}/oauth/agent/nonce?wallet=${w.address}`)).json()) as { message: string };
    const { verifySiws } = await import("../src/auth/siws.js");
    await assert.rejects(verifySiws({ wallet: w.address, message: n.message, signature: await sign(w, n.message) }, "login"));
  });

  it("nonce reutilizado falha", async () => {
    const w = await generateKeyPairSigner();
    const n = (await (await fetch(`${base}/oauth/agent/nonce?wallet=${w.address}`)).json()) as { message: string };
    const body = { wallet: w.address, message: n.message, signature: await sign(w, n.message) };
    assert.equal((await post("/oauth/agent/token", body)).status, 200);
    assert.equal((await post("/oauth/agent/token", body)).status, 401);
  });

  it("assinatura de outra carteira falha (e o nonce não é gasto por isso)", async () => {
    const w = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    assert.equal((await login(w, { signer: other })).status, 401);
  });

  it("a mensagem do nonce diz que não autoriza pagamentos", async () => {
    const w = await generateKeyPairSigner();
    const n = (await (await fetch(`${base}/oauth/agent/nonce?wallet=${w.address}`)).json()) as { message: string };
    assert.match(n.message, /Isto não autoriza pagamentos/);
  });

  it("carteira inválida no nonce: 400", async () => {
    assert.equal((await fetch(`${base}/oauth/agent/nonce?wallet=abc`)).status, 400);
  });

  it("refresh com client_id=agent rotaciona e revoga o antigo", async () => {
    const w = await generateKeyPairSigner();
    const first = (await (await login(w)).json()) as { access_token: string; refresh_token: string };
    const refresh = (rt: string) =>
      fetch(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: "agent" }),
      });
    const res = await refresh(first.refresh_token);
    assert.equal(res.status, 200);
    const second = (await res.json()) as { access_token: string; refresh_token: string };
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.equal((await refresh(first.refresh_token)).status, 400); // o antigo foi revogado
    // O sucessor continua sendo token de agente e o antigo access token deixou de valer.
    assert.match(await callText(second.access_token, "list_my_solvers", {}), /Você ainda não tem especialistas/);
    const old = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${first.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(old.status, 401);
    // client_id errado não consome o refresh.
    const bad = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: "cli_outro" }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await refresh(second.refresh_token)).status, 200);
  });

  it("os metadados anunciam os endpoints do agente", async () => {
    const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
    assert.match(meta.agent_nonce_endpoint!, /\/oauth\/agent\/nonce$/);
    assert.match(meta.agent_token_endpoint!, /\/oauth\/agent\/token$/);
  });

  it("agente sem licença: activate_solver devolve as instruções x402, sem checkout e sem linha em trials", async () => {
    const w = await generateKeyPairSigner();
    const tok = (await (await login(w)).json()) as { access_token: string };
    const out = await callText(tok.access_token, "activate_solver", { agent_id: AGENT });
    assert.match(out, /x402/);
    assert.match(out, new RegExp(`/api/x402/solvers/${AGENT}/license`));
    assert.match(out, /20 USDC/);
    assert.doesNotMatch(out, /\/checkout/);
    assert.doesNotMatch(out, /[Mm]ostre/);
    assert.equal((await db.select().from(schema.trials).where(eq(schema.trials.wallet, w.address))).length, 0);
    assert.equal((await db.select().from(schema.sessions).where(eq(schema.sessions.wallet, w.address))).length, 0);
    // find_solver e get_purchase_link também falam a língua do agente.
    for (const [name, args] of [["find_solver", { need: "componentes react acessíveis" }], ["get_purchase_link", { agent_id: AGENT }]] as const) {
      const t = await callText(tok.access_token, name, args);
      assert.doesNotMatch(t, /\/checkout/, name);
      assert.doesNotMatch(t, /[Mm]ostre o link|mostre ao usuário/, name);
    }
  });

  it("regressão: a pessoa (token do navegador) segue com teste grátis e link de checkout", async () => {
    const w = await generateKeyPairSigner();
    const human = await issueHuman(w.address);
    const out = await callText(human.access_token, "activate_solver", { agent_id: AGENT });
    assert.match(out, /session_id:/);
    assert.match(out, /[Tt]este grátis/);
    assert.equal((await db.select().from(schema.trials).where(eq(schema.trials.wallet, w.address))).length, 1);
    const link = await callText(human.access_token, "get_purchase_link", { agent_id: AGENT });
    assert.match(link, /\/checkout\?agent=/);
  });

  it("agente com sessão de teste antiga (carteira usada por uma pessoa antes) não a reaproveita", async () => {
    const w = await generateKeyPairSigner();
    const human = await issueHuman(w.address);
    assert.match(await callText(human.access_token, "activate_solver", { agent_id: AGENT }), /session_id:/);
    const tok = (await (await login(w)).json()) as { access_token: string };
    const out = await callText(tok.access_token, "activate_solver", { agent_id: AGENT });
    assert.match(out, /x402/);
    assert.doesNotMatch(out, /session_id:/);
  });

  it("RPC fora do ar não vira 'sem licença': activate_solver pede para tentar de novo, não manda comprar nem gasta teste", async () => {
    // O RPC do teste é uma porta fechada: findLicenses falha, e a licença não pode ser confirmada nem negada.
    for (const mode of ["agente", "pessoa"] as const) {
      const w = await generateKeyPairSigner();
      const token = mode === "agente" ? ((await (await login(w)).json()) as { access_token: string }).access_token : (await issueHuman(w.address)).access_token;
      const out = await callText(token, "activate_solver", { agent_id: AGENT2 });
      assert.match(out, /Não consegui confirmar sua licença/, mode);
      assert.doesNotMatch(out, /\/checkout|x402|Comprar/, mode);
      assert.equal((await db.select().from(schema.trials).where(eq(schema.trials.wallet, w.address))).length, 0, mode);
    }
  });

  it("list_my_solvers: licença cujo dono mudou on-chain some; erro de RPC mantém a do banco", async () => {
    const { chain } = await import("../src/chain/index.js");
    const c = chain() as unknown as { fetchCoreAsset: (a: string) => Promise<{ owner: string } | null> };
    const original = c.fetchCoreAsset;
    const w = await generateKeyPairSigner();
    const [soldAsset, keptAsset] = [(await generateKeyPairSigner()).address, (await generateKeyPairSigner()).address];
    await db.insert(schema.licenses).values([
      { id: soldAsset, agentId: AGENT, ownerWallet: w.address },
      { id: keptAsset, agentId: AGENT2, ownerWallet: w.address },
    ]);
    const tok = (await (await login(w)).json()) as { access_token: string };
    try {
      // Revendida: o asset agora é de outra carteira; a outra consulta falha (RPC) e mantém a licença do banco.
      c.fetchCoreAsset = async (a: string) => {
        if (a === soldAsset) return { owner: "OutraCarteira1111111111111111111111111111111" };
        throw new Error("rpc fora do ar");
      };
      const out = await callText(tok.access_token, "list_my_solvers", {});
      assert.doesNotMatch(out, new RegExp(AGENT), "licença revendida não pode aparecer");
      assert.match(out, new RegExp(AGENT2));
    } finally {
      c.fetchCoreAsset = original;
    }
  });

  it("assertCanPurchase: criador, licença já possuída (dono on-chain), licença transferida e sem licença", async () => {
    const { assertCanPurchase } = await import("../src/store/purchase-guards.js");
    const { chain } = await import("../src/chain/index.js");
    const c = chain() as unknown as { fetchCoreAsset: (a: string) => Promise<{ owner: string } | null> };
    const original = c.fetchCoreAsset;
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, AGENT));
    const w = await generateKeyPairSigner();
    const asset = (await generateKeyPairSigner()).address;
    const code = async (wallet: string) => assertCanPurchase(wallet, row!).then(() => null, (e: { status: number; code: string; extra?: { assetId?: string } }) => e);
    try {
      c.fetchCoreAsset = async () => ({ owner: w.address });
      assert.equal(await code(w.address), null, "sem licença no banco: pode comprar");
      const creatorErr = await code(creatorWallet);
      assert.equal(creatorErr?.status, 400);
      assert.equal(creatorErr?.code, "creator_cannot_buy");

      await db.insert(schema.licenses).values({ id: asset, agentId: AGENT, ownerWallet: w.address });
      const owned = await code(w.address);
      assert.equal(owned?.status, 409);
      assert.equal(owned?.code, "already_owned");
      assert.equal(owned?.extra?.assetId, asset);

      // Transferida fora da plataforma: o dono on-chain mudou, então pode comprar de novo.
      c.fetchCoreAsset = async () => ({ owner: "OutraCarteira1111111111111111111111111111111" });
      assert.equal(await code(w.address), null);
      // O refresh espelhou o novo dono: a linha deixou de ser da carteira.
      const [lic] = await db.select().from(schema.licenses).where(eq(schema.licenses.id, asset));
      assert.notEqual(lic!.ownerWallet, w.address);
    } finally {
      c.fetchCoreAsset = original;
    }
  });
});

import express, { Router, type Express } from "express";
import cors from "cors";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { h, HttpError, parse } from "../lib/http.js";
import { randomId, randomToken, sha256Hex } from "../lib/crypto.js";
import { mcpAudience, signAccessToken, verifyToken } from "../auth/jwt.js";
import { createNonce, decodeVerifiedSignature, MEMORY_KEY_MESSAGE, verifySiws } from "../auth/siws.js";
import { deriveMemoryKey, storeMemoryKey, wrapKey, type DbExecutor } from "../memory/crypto.js";
import { authorizePage } from "./page.js";
import { AGENT_CLIENT_ID, AGENT_SIWS_STATEMENT, refreshRejection } from "./rules.js";

// Autorização do conector MCP (INSTRUCTIONS.md 5.2): o /mcp é um resource server e este app
// também é o authorization server (OAuth 2.1 + PKCE S256 + registro dinâmico de cliente).

const ACCESS_TTL_SECS = 24 * 3600;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const AUTH_REQ_TTL_MS = 10 * 60 * 1000;

const base = () => env.PUBLIC_API_URL.replace(/\/$/, "");

class OAuthError extends HttpError {
  constructor(error: string, description: string, status = 400) {
    super(status, description, error, { error, error_description: description });
  }
}

export function protectedResourceMetadata() {
  return {
    resource: mcpAudience(),
    authorization_servers: [base()],
    scopes_supported: ["solvers"],
    bearer_methods_supported: ["header"],
    resource_name: "Solvers",
    resource_documentation: `${env.PUBLIC_WEB_URL.replace(/\/$/, "")}/install`,
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: base(),
    authorization_endpoint: `${base()}/oauth/authorize`,
    token_endpoint: `${base()}/oauth/token`,
    registration_endpoint: `${base()}/oauth/register`,
    revocation_endpoint: `${base()}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Extensão não padrão: login direto de agentes com carteira (duas chamadas, sem navegador). Ver docs/agentes-login.md.
    agent_nonce_endpoint: `${base()}/oauth/agent/nonce`,
    agent_token_endpoint: `${base()}/oauth/agent/token`,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["solvers"],
  };
}

const RegisterBody = z.object({
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  client_name: z.string().max(200).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
});

function allowedRedirect(uri: string): boolean {
  const u = new URL(uri);
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

async function getClient(clientId: string) {
  const [c] = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId));
  return c ? { ...c, meta: c.metadata as { redirect_uris: string[]; client_name?: string } } : null;
}

const AuthorizeQuery = z.object({
  response_type: z.literal("code"),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1000).optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
});

type AuthRequest = z.infer<typeof AuthorizeQuery> & { clientName: string; nonce?: string };

async function saveAuthRequest(req: AuthRequest): Promise<string> {
  const id = `ar_${randomId(12)}`;
  // Limpa só pedidos de autorização vencidos (o kv guarda outras coisas, como o cursor do indexador).
  await db.delete(schema.kv).where(and(like(schema.kv.key, "oauth:req:%"), lt(schema.kv.updatedAt, new Date(Date.now() - AUTH_REQ_TTL_MS))));
  await db.insert(schema.kv).values({ key: `oauth:req:${id}`, value: req });
  return id;
}

/** Clientes conhecidos: a página mostra o destino como verificado; os demais recebem aviso. */
const KNOWN_REDIRECT_HOSTS = ["claude.ai", "claude.com", "chatgpt.com", "chat.openai.com", "openai.com", "localhost", "127.0.0.1"];

function redirectInfo(uri: string) {
  const host = new URL(uri).hostname;
  const verified = KNOWN_REDIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  return { host, verified };
}

async function loadAuthRequest(id: string): Promise<AuthRequest> {
  const [row] = await db
    .select()
    .from(schema.kv)
    .where(and(eq(schema.kv.key, `oauth:req:${id}`), gt(schema.kv.updatedAt, new Date(Date.now() - AUTH_REQ_TTL_MS))));
  if (!row) throw new OAuthError("invalid_request", "Pedido de autorização expirou. Volte ao Claude/ChatGPT e conecte de novo.");
  return row.value as AuthRequest;
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** `exec` permite emitir dentro de uma transação (rotação do refresh: tudo ou nada). */
async function issueTokens(clientId: string, wallet: string, wrappedMemoryKey: Buffer | null, exec: DbExecutor = db) {
  const tokenId = `tok_${randomId(12)}`;
  const refresh = randomToken(32);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await exec.insert(schema.oauthTokens).values({ id: tokenId, clientId, wallet, refreshHash: sha256Hex(refresh), expiresAt });
  // A chave de memória vive enquanto a autorização vale; revogar ou expirar a apaga.
  if (wrappedMemoryKey) await storeMemoryKey(tokenId, wallet, wrappedMemoryKey, expiresAt, exec);
  const access = await signAccessToken(wallet, tokenId, clientId, ACCESS_TTL_SECS);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECS,
    refresh_token: refresh,
    scope: "solvers",
  };
}

export const oauthRouter = Router();
const open = cors({ origin: true });

/** Nonce do agente: 10 por minuto POR CARTEIRA (a tabela de nonces é escrita sem autenticação). */
const agentNonceLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => (typeof req.query.wallet === "string" ? req.query.wallet.slice(0, 64) : "anon"),
  validate: { keyGeneratorIpFallback: false },
  message: { error: "too_many_requests", error_description: "Muitas tentativas para esta carteira. Aguarde um minuto." },
});

oauthRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "0.0.0.0"),
    message: { error: "too_many_requests", error_description: "Muitas tentativas. Aguarde um minuto." },
  }),
);

oauthRouter.post(
  "/register",
  open,
  express.json(),
  h(async (req, res) => {
    const body = RegisterBody.safeParse(req.body);
    if (!body.success) throw new OAuthError("invalid_client_metadata", body.error.issues[0]?.message ?? "metadados inválidos");
    for (const uri of body.data.redirect_uris) {
      if (!allowedRedirect(uri)) throw new OAuthError("invalid_redirect_uri", `redirect_uri não permitido: ${uri}`);
    }
    const clientId = `cli_${randomId(12)}`;
    const metadata = {
      redirect_uris: body.data.redirect_uris,
      client_name: body.data.client_name ?? "Cliente MCP",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "solvers",
    };
    await db.insert(schema.oauthClients).values({ clientId, metadata });
    res.status(201);
    return { client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), ...metadata };
  }),
);

oauthRouter.get(
  "/authorize",
  h(async (req, res) => {
    const q = AuthorizeQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).type("html").send(authorizePage({ error: "Pedido de autorização inválido. Tente conectar de novo pelo Claude ou ChatGPT." }));
      return;
    }
    const client = await getClient(q.data.client_id);
    if (!client || !client.meta.redirect_uris.includes(q.data.redirect_uri)) {
      res.status(400).type("html").send(authorizePage({ error: "Aplicativo não reconhecido. Tente conectar de novo." }));
      return;
    }
    if (q.data.resource && q.data.resource.replace(/\/$/, "") !== mcpAudience()) {
      res.status(400).type("html").send(authorizePage({ error: "Recurso solicitado não pertence a este servidor." }));
      return;
    }
    const clientName = client.meta.client_name ?? "Seu assistente de IA";
    const id = await saveAuthRequest({ ...q.data, clientName });
    // A autorização acontece na vitrine (/connect), onde o login por e-mail (Privy) e a carteira embutida funcionam.
    res.redirect(302, `${env.PUBLIC_WEB_URL.replace(/\/$/, "")}/connect?req=${encodeURIComponent(id)}`);
  }),
);

/** Dados do pedido para a tela de consentimento da vitrine. */
oauthRouter.get(
  "/authorize/info",
  h(async (req) => {
    const { req: id } = parse(z.object({ req: z.string() }), req.query);
    const ar = await loadAuthRequest(id);
    const { host, verified } = redirectInfo(ar.redirect_uri);
    return {
      clientName: ar.clientName,
      redirectHost: host,
      verified,
      memoryMessage: MEMORY_KEY_MESSAGE,
      extensionUrl: `${base()}/oauth/authorize/extension?req=${encodeURIComponent(id)}`,
    };
  }),
);

/** Alternativa para quem usa carteira de extensão (Phantom, Solflare, Backpack): a página servida pelo servidor. */
oauthRouter.get(
  "/authorize/extension",
  h(async (req, res) => {
    const id = typeof req.query.req === "string" ? req.query.req : "";
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    const ar = await loadAuthRequest(id).catch(() => null);
    if (!ar) {
      res.status(400).type("html").send(authorizePage({ error: "Pedido de autorização expirou. Volte ao Claude/ChatGPT e conecte de novo." }));
      return;
    }
    const { host, verified } = redirectInfo(ar.redirect_uri);
    res.type("html").send(
      authorizePage({ requestId: id, clientName: ar.clientName, redirectHost: host, verified, apiBase: base(), webUrl: env.PUBLIC_WEB_URL, memoryMessage: MEMORY_KEY_MESSAGE }),
    );
  }),
);

oauthRouter.get(
  "/authorize/nonce",
  h(async (req) => {
    const { req: id, wallet } = parse(z.object({ req: z.string(), wallet: z.string().min(32).max(44) }), req.query);
    const ar = await loadAuthRequest(id);
    const { host } = redirectInfo(ar.redirect_uri);
    // A mensagem assinada diz para quem o acesso vai; o nonce fica ligado a este pedido.
    const n = await createNonce(wallet, "oauth", `Autorizar ${ar.clientName} (${host}) a usar seus especialistas do Solvers. Isto não autoriza pagamentos.`);
    await db.update(schema.kv).set({ value: { ...ar, nonce: n.nonce } }).where(eq(schema.kv.key, `oauth:req:${id}`));
    return n;
  }),
);

oauthRouter.post(
  "/authorize/complete",
  express.json(),
  h(async (req) => {
    const body = parse(
      z.object({
        req: z.string(),
        wallet: z.string(),
        message: z.string().max(2000),
        signature: z.union([z.string(), z.array(z.number())]),
        memorySignature: z.union([z.string(), z.array(z.number())]).optional(),
      }),
      req.body,
    );
    const ar = await loadAuthRequest(body.req);
    if (!ar.nonce || !body.message.includes(`Nonce: ${ar.nonce}`)) throw new OAuthError("invalid_request", "Assinatura não pertence a este pedido de autorização");
    const wallet = await verifySiws({ wallet: body.wallet, message: body.message, signature: body.signature }, "oauth");

    let wrapped: Buffer | null = null;
    if (body.memorySignature) {
      const sig = decodeVerifiedSignature(wallet, MEMORY_KEY_MESSAGE, body.memorySignature);
      if (!sig) throw new OAuthError("access_denied", "Assinatura da chave de memória inválida", 401);
      wrapped = wrapKey(deriveMemoryKey(sig, wallet));
    }

    const code = randomToken(24);
    await db.delete(schema.oauthCodes).where(lt(schema.oauthCodes.expiresAt, new Date()));
    await db.insert(schema.oauthCodes).values({
      code,
      clientId: ar.client_id,
      wallet,
      codeChallenge: ar.code_challenge,
      redirectUri: ar.redirect_uri,
      scope: ar.scope ?? "solvers",
      resource: ar.resource ?? mcpAudience(),
      memoryKey: wrapped,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    await db.delete(schema.kv).where(eq(schema.kv.key, `oauth:req:${body.req}`));
    const url = new URL(ar.redirect_uri);
    url.searchParams.set("code", code);
    if (ar.state) url.searchParams.set("state", ar.state);
    return { redirectTo: url.toString() };
  }),
);

// Login direto do agente (docs/agentes-login.md): duas chamadas, sem navegador nem registro de cliente.
// Nonce com purpose "agent": não vale no fluxo do navegador ("oauth") nem no login da vitrine ("login"), e vice-versa.
oauthRouter.get(
  "/agent/nonce",
  open,
  agentNonceLimit,
  h(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { wallet } = parse(z.object({ wallet: z.string().min(32).max(44) }), req.query);
    return createNonce(wallet, "agent", AGENT_SIWS_STATEMENT);
  }),
);

oauthRouter.post(
  "/agent/token",
  open,
  express.json(),
  h(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = parse(
      z.object({
        wallet: z.string(),
        message: z.string().max(2000),
        signature: z.union([z.string(), z.array(z.number())]),
        memorySignature: z.union([z.string(), z.array(z.number())]).optional(),
      }),
      req.body,
    );
    const wallet = await verifySiws({ wallet: body.wallet, message: body.message, signature: body.signature }, "agent");
    let wrapped: Buffer | null = null;
    if (body.memorySignature) {
      const sig = decodeVerifiedSignature(wallet, MEMORY_KEY_MESSAGE, body.memorySignature);
      if (!sig) throw new OAuthError("access_denied", "Assinatura da chave de memória inválida", 401);
      wrapped = wrapKey(deriveMemoryKey(sig, wallet));
    }
    return issueTokens(AGENT_CLIENT_ID, wallet, wrapped);
  }),
);

oauthRouter.post(
  "/token",
  open,
  express.urlencoded({ extended: false }),
  express.json(),
  h(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const b = req.body as Record<string, string>;
    if (b.grant_type === "authorization_code") {
      if (!b.code || !b.code_verifier || !b.client_id) throw new OAuthError("invalid_request", "code, code_verifier e client_id são obrigatórios");
      const [row] = await db.delete(schema.oauthCodes).where(eq(schema.oauthCodes.code, b.code)).returning();
      if (!row || row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Código inválido ou expirado");
      if (row.clientId !== b.client_id) throw new OAuthError("invalid_grant", "Código de outro cliente");
      if (b.redirect_uri && b.redirect_uri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri não confere");
      if (s256(b.code_verifier) !== row.codeChallenge) throw new OAuthError("invalid_grant", "PKCE inválido");
      if (b.resource && b.resource.replace(/\/$/, "") !== mcpAudience()) throw new OAuthError("invalid_target", "Recurso inválido");
      return issueTokens(row.clientId, row.wallet, row.memoryKey ?? null);
    }
    if (b.grant_type === "refresh_token") {
      if (!b.refresh_token) throw new OAuthError("invalid_request", "refresh_token é obrigatório");
      const refreshHash = sha256Hex(b.refresh_token);
      // Rotação tudo ou nada: revogar o refresh antigo, mover a chave de memória e emitir o sucessor numa só
      // transação. Falha no meio desfaz tudo e o cliente continua com o refresh antigo válido. A linha fica
      // travada (for update): uma segunda requisição com o mesmo refresh espera e depois o vê revogado.
      return db.transaction(async (tx) => {
        const [tok] = await tx.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.refreshHash, refreshHash)).for("update");
        // Valida antes de revogar: pedido inválido não consome o token do cliente legítimo.
        const rejection = refreshRejection(tok, b.client_id, new Date());
        if (rejection || !tok) throw new OAuthError("invalid_grant", rejection ?? "Refresh token inválido ou expirado");
        await tx.update(schema.oauthTokens).set({ revoked: true }).where(eq(schema.oauthTokens.id, tok.id));
        const [mk] = await tx.delete(schema.memoryKeys).where(eq(schema.memoryKeys.tokenId, tok.id)).returning();
        return issueTokens(tok.clientId, tok.wallet, mk?.wrappedKey ?? null, tx);
      });
    }
    throw new OAuthError("unsupported_grant_type", "grant_type não suportado");
  }),
);

oauthRouter.post(
  "/revoke",
  open,
  express.urlencoded({ extended: false }),
  express.json(),
  h(async (req) => {
    const token = (req.body as Record<string, string>).token;
    if (token) {
      let tokenId: string | undefined;
      const [byRefresh] = await db
        .update(schema.oauthTokens)
        .set({ revoked: true })
        .where(eq(schema.oauthTokens.refreshHash, sha256Hex(token)))
        .returning();
      tokenId = byRefresh?.id;
      if (!tokenId) {
        // Pode ser o access token (JWT): revoga pelo jti.
        const claims = await verifyToken(token, mcpAudience()).catch(() => null);
        if (claims?.jti) {
          await db.update(schema.oauthTokens).set({ revoked: true }).where(eq(schema.oauthTokens.id, claims.jti));
          tokenId = claims.jti;
        }
      }
      if (tokenId) await db.delete(schema.memoryKeys).where(eq(schema.memoryKeys.tokenId, tokenId));
    }
    return {};
  }),
);

export function mountOAuth(app: Express) {
  const wellKnown = Router();
  wellKnown.use(open);
  wellKnown.get(["/oauth-protected-resource", "/oauth-protected-resource/mcp"], (_req, res) => {
    res.json(protectedResourceMetadata());
  });
  wellKnown.get(["/oauth-authorization-server", "/oauth-authorization-server/mcp", "/openid-configuration"], (_req, res) => {
    res.json(authorizationServerMetadata());
  });
  app.use("/.well-known", wellKnown);
  app.use("/oauth", oauthRouter);
}

export { issueTokens as _issueTokensForTests };

import express, { Router, type Express } from "express";
import cors from "cors";
import { and, eq, gt, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { h, HttpError, parse } from "../lib/http.js";
import { randomId, randomToken, sha256Hex } from "../lib/crypto.js";
import { mcpAudience, signAccessToken } from "../auth/jwt.js";
import { createNonce, decodeVerifiedSignature, MEMORY_KEY_MESSAGE, verifySiws } from "../auth/siws.js";
import { deriveMemoryKey, storeMemoryKey, wrapKey } from "../memory/crypto.js";
import { authorizePage } from "./page.js";

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
    resource_documentation: `${env.PUBLIC_WEB_URL.replace(/\/$/, "")}/instalar`,
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

type AuthRequest = z.infer<typeof AuthorizeQuery> & { clientName: string };

async function saveAuthRequest(req: AuthRequest): Promise<string> {
  const id = `ar_${randomId(12)}`;
  await db.delete(schema.kv).where(lt(schema.kv.updatedAt, new Date(Date.now() - AUTH_REQ_TTL_MS)));
  await db.insert(schema.kv).values({ key: `oauth:req:${id}`, value: req });
  return id;
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

async function issueTokens(clientId: string, wallet: string, wrappedMemoryKey: Buffer | null) {
  const tokenId = `tok_${randomId(12)}`;
  const refresh = randomToken(32);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await db.insert(schema.oauthTokens).values({ id: tokenId, clientId, wallet, refreshHash: sha256Hex(refresh), expiresAt });
  // A chave de memória vive enquanto a autorização vale; revogar ou expirar a apaga.
  if (wrappedMemoryKey) await storeMemoryKey(tokenId, wallet, wrappedMemoryKey, expiresAt);
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
    res.type("html").send(authorizePage({ requestId: id, clientName, apiBase: base(), memoryMessage: MEMORY_KEY_MESSAGE }));
  }),
);

oauthRouter.get(
  "/authorize/nonce",
  h(async (req) => {
    const { req: id, wallet } = parse(z.object({ req: z.string(), wallet: z.string().min(32).max(44) }), req.query);
    await loadAuthRequest(id);
    return createNonce(wallet, "oauth");
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
      const [tok] = await db
        .select()
        .from(schema.oauthTokens)
        .where(and(eq(schema.oauthTokens.refreshHash, sha256Hex(b.refresh_token)), eq(schema.oauthTokens.revoked, false)));
      if (!tok || tok.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Refresh token inválido ou expirado");
      if (b.client_id && b.client_id !== tok.clientId) throw new OAuthError("invalid_grant", "Refresh token de outro cliente");
      // Rotação: o refresh antigo deixa de valer e a chave de memória passa para o novo token.
      await db.update(schema.oauthTokens).set({ revoked: true }).where(eq(schema.oauthTokens.id, tok.id));
      const [mk] = await db.delete(schema.memoryKeys).where(eq(schema.memoryKeys.tokenId, tok.id)).returning();
      return issueTokens(tok.clientId, tok.wallet, mk?.wrappedKey ?? null);
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
      const [tok] = await db
        .update(schema.oauthTokens)
        .set({ revoked: true })
        .where(eq(schema.oauthTokens.refreshHash, sha256Hex(token)))
        .returning();
      if (tok) await db.delete(schema.memoryKeys).where(eq(schema.memoryKeys.tokenId, tok.id));
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

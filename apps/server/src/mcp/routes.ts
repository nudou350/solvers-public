import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { and, eq, gt } from "drizzle-orm";
import { rateLimit } from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { mcpAudience, verifyToken } from "../auth/jwt.js";
import { buildMcpServer } from "./tools.js";

const resourceMetadataUrl = () => `${env.PUBLIC_API_URL.replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp`;

function challenge(res: Response, error?: string) {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl()}"`];
  if (error) parts.push(`error="${error}"`);
  res.setHeader("WWW-Authenticate", parts.join(", "));
  res.status(401).json({ error: error ?? "unauthorized", error_description: "Conecte sua carteira ao Solvers para usar os especialistas." });
}

/** Sem token válido: 401 com WWW-Authenticate apontando o metadata do recurso (dispara o OAuth no cliente). */
async function bearer(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return challenge(res);
  try {
    const claims = await verifyToken(auth.slice(7), mcpAudience());
    if (!claims.jti) return challenge(res, "invalid_token");
    const [tok] = await db
      .select({ id: schema.oauthTokens.id })
      .from(schema.oauthTokens)
      .where(and(eq(schema.oauthTokens.id, claims.jti), eq(schema.oauthTokens.revoked, false), gt(schema.oauthTokens.expiresAt, new Date())));
    if (!tok) return challenge(res, "invalid_token");
    req.wallet = claims.sub;
    req.tokenId = claims.jti;
    next();
  } catch {
    challenge(res, "invalid_token");
  }
}

export function mountMcp(app: Express) {
  const perWallet = rateLimit({
    windowMs: 60_000,
    limit: env.RATE_LIMIT_PER_MINUTE,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.wallet ?? "anon",
    message: { jsonrpc: "2.0", error: { code: -32000, message: "Muitas chamadas por minuto. Aguarde um pouco." }, id: null },
  });

  const handler = async (req: Request, res: Response) => {
    // Modo stateless: um servidor MCP por requisição, amarrado à carteira do token.
    const server = buildMcpServer({ wallet: req.wallet!, tokenId: req.tokenId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp] erro", e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Erro interno" }, id: null });
    }
  };

  const mcpCors = cors({ origin: true, exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"] });
  app.options("/mcp", mcpCors);
  app.post("/mcp", mcpCors, express.json({ limit: "1mb" }), bearer, perWallet, handler);
  // Sem sessões com estado: GET (stream do servidor) e DELETE não se aplicam.
  app.get("/mcp", mcpCors, bearer, (_req, res) => {
    res.status(405).setHeader("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST" }, id: null });
  });
  app.delete("/mcp", mcpCors, bearer, (_req, res) => {
    res.status(405).setHeader("Allow", "POST").end();
  });
}

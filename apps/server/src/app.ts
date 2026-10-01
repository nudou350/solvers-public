import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "./env.js";
import { authRouter } from "./auth/routes.js";
import { optionalAuth } from "./auth/jwt.js";
import { storeRouter } from "./store/routes.js";
import { webhookRouter } from "./indexer/poller.js";
import { pixRouter, pixWebhookRouter } from "./pix/routes.js";
import { sodaxRouter } from "./sodax/routes.js";
import { errorHandler } from "./lib/http.js";
import { pool } from "./db/index.js";

/** Rotas extras registradas por outros módulos (MCP, OAuth, garantia...) antes do handler de erro. */
export type Mount = (app: Express) => void;

export function createApp(mounts: Mount[] = []): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("select 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const origins = new Set([env.PUBLIC_WEB_URL.replace(/\/$/, "")]);
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://localhost:5173");
  }
  const webCors = cors({
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    credentials: true,
  });

  // Sempre por IP; por carteira em cima (trocar de carteira não burla o limite do IP).
  const byIp = rateLimit({
    windowMs: 60_000,
    limit: env.RATE_LIMIT_PER_MINUTE * 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas requisições. Aguarde um pouco e tente de novo.", code: "rate_limited" },
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "0.0.0.0"),
  });
  const byWallet = rateLimit({
    windowMs: 60_000,
    limit: env.RATE_LIMIT_PER_MINUTE * 2,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas requisições. Aguarde um pouco e tente de novo.", code: "rate_limited" },
    skip: (req) => !req.wallet,
    keyGenerator: (req) => req.wallet ?? "anon",
  });
  // Rotas caras (embedding na CPU, polling de RPC, transações).
  const costly = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas requisições. Aguarde um pouco e tente de novo.", code: "rate_limited" },
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "0.0.0.0"),
  });

  // Assinatura do Mercado Pago usa só query e headers: o corpo já pode ser JSON parseado.
  app.use("/webhooks", express.json({ limit: "2mb" }), webhookRouter, pixWebhookRouter);
  app.use("/api", webCors, express.json({ limit: "256kb" }), cookieParser(), byIp, optionalAuth, byWallet);
  app.use(["/api/search", "/api/tx", "/api/faucet"], costly);
  // Criar/simular Pix tem o mesmo limite do faucet; a consulta (polling do front) não.
  app.use(["/api/pix", "/api/sodax"], (req, res, next) => (req.method === "POST" ? costly(req, res, next) : next()));
  app.use("/api/auth", authRouter);
  app.use("/api", storeRouter);
  app.use("/api", pixRouter);
  app.use("/api", sodaxRouter);

  for (const mount of mounts) mount(app);

  app.use((_req, res) => {
    res.status(404).json({ error: "Rota não encontrada", code: "not_found" });
  });
  app.use(errorHandler);
  return app;
}

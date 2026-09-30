import { Router } from "express";
import { z } from "zod";
import { env } from "../env.js";
import { h, parse } from "../lib/http.js";
import { SESSION_COOKIE, signSession, requireAuth, requireWallet } from "./jwt.js";
import { createNonce, verifySiws } from "./siws.js";

export const authRouter = Router();

authRouter.get(
  "/nonce",
  h(async (req) => {
    const wallet = parse(z.string().min(32).max(44), req.query.wallet);
    return createNonce(wallet);
  }),
);

authRouter.post(
  "/verify",
  h(async (req, res) => {
    const body = parse(
      z.object({
        wallet: z.string(),
        message: z.string().max(2000),
        signature: z.union([z.string(), z.array(z.number())]),
      }),
      req.body,
    );
    const wallet = await verifySiws(body);
    const token = await signSession(wallet);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 3600 * 1000,
      path: "/",
    });
    return { wallet, token, expiresIn: 24 * 3600 };
  }),
);

authRouter.post(
  "/logout",
  h(async (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  h(async (req) => ({ wallet: requireWallet(req) })),
);

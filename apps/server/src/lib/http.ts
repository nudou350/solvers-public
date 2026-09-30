import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = "bad_request", extra?: Record<string, unknown>) => new HttpError(400, msg, code, extra);
export const unauthorized = (msg = "Faça login para continuar") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "Acesso negado") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Não encontrado") => new HttpError(404, msg, "not_found");

/** Serializa bigint como número (valores de API já estão convertidos; isto é só uma rede de segurança). */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "validation");
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    return;
  }
  const status = (err as { status?: number; type?: string })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const type = (err as { type?: string }).type;
    res.status(status).json({
      error: type === "entity.parse.failed" ? "JSON inválido" : type === "entity.too.large" ? "Corpo grande demais" : "Requisição inválida",
      code: type ?? "bad_request",
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.message, code: "validation" });
    return;
  }
  const e = err as { name?: string; message?: string; logs?: string[] };
  if (e?.name === "TxError" || e?.constructor?.name === "TxError") {
    res.status(422).json({ error: e.message, code: "transaction_failed", logs: e.logs?.slice(-8) });
    return;
  }
  console.error("[erro]", err);
  res.status(500).json({ error: "Erro interno", code: "internal" });
}

/** Express 5 já propaga rejeições de handlers async; este helper só tipa o handler. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  async (req, res, next) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(jsonSafe(out));
    } catch (e) {
      next(e);
    }
  };

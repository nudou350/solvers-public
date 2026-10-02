import { closeSync, createWriteStream, openSync, readSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { SUBMISSION_OPEN_STATUSES } from "@solvers/shared";
import { requireAuth } from "../auth/jwt.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { randomId } from "../lib/crypto.js";
import { HttpError, forbidden } from "../lib/http.js";
import { adminMessage, notifyAdmin } from "./notify.js";
import { SUBMISSION_ID_RE, submissionDir, zipPathOf, zipRelPath } from "./paths.js";
import { canResubmit, creatorNotReady, uploadLimitProblem } from "./rules.js";

// POST /api/creator/submissions: recebe o ZIP em corpo cru (`application/zip`) e o grava em streaming em
// SUBMISSIONS_DIR/<id>/package.zip, sem bufferizar na memória (PACKAGE_SPEC.md 13, 14.4 e 16). Responde 202: a extração, as
// varreduras e a validação rodam no worker. Montada em app.ts ANTES do express.json (que tem teto de 256 KB), com a
// própria autenticação, e a ordem das conferências é de propósito: login, perfil/convite/termos, limites e tamanho
// declarado ANTES de ler o primeiro byte do corpo.
//
// Reenvio depois de `changes_requested`: POST ...?resubmit=<id> troca o ZIP da MESMA submissão e volta a `validating`.

const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"]);
const PK_HEADERS = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])];

const err = (status: number, message: string, code: string, extra?: Record<string, unknown>) => new HttpError(status, message, code, extra);

/** Conta quantos envios o criador tem em andamento e quantos fez nas últimas 24 h. */
async function uploadCounts(wallet: string): Promise<{ pending: number; last24h: number }> {
  const mine = eq(schema.packageSubmissions.creatorWallet, wallet);
  const [p] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.packageSubmissions)
    .where(and(mine, inArray(schema.packageSubmissions.status, [...SUBMISSION_OPEN_STATUSES])));
  const [d] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.packageSubmissions)
    .where(and(mine, gt(schema.packageSubmissions.createdAt, sql`now() - interval '24 hours'`)));
  return { pending: p?.n ?? 0, last24h: d?.n ?? 0 };
}

/** Os primeiros bytes são os de um ZIP (assinatura local ou diretório central de um ZIP vazio). */
function looksLikeZip(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(4);
    const n = readSync(fd, head, 0, 4, 0);
    return n === 4 && PK_HEADERS.some((h) => h.equals(head));
  } finally {
    closeSync(fd);
  }
}

/** Grava o corpo em `dest` em streaming, abortando ao passar de `max` bytes (o Content-Length pode faltar ou mentir). */
async function receiveBody(req: Request, dest: string, max: number): Promise<number> {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > max) return cb(err(413, `O ZIP passa do limite de ${Math.floor(max / (1024 * 1024))} MB.`, "payload_too_large", { maxBytes: max }));
      cb(null, chunk);
    },
  });
  await pipeline(req, counter, createWriteStream(dest, { flags: "wx", mode: 0o640 }));
  return size;
}

/**
 * Respondeu sem ter lido o corpo (recusa antes do upload): fecha a conexão em vez de engolir gigabytes que ninguém vai usar.
 * O cabeçalho "Connection: close" manda o Node encerrar depois da resposta; o temporizador derruba o que ainda estiver aberto.
 */
const closeUnreadBody: RequestHandler = (req, res, next) => {
  res.setHeader("Connection", "close");
  res.once("finish", () => {
    if (req.readableEnded) return;
    const t = setTimeout(() => req.socket.destroy(), 5000);
    t.unref();
    res.once("close", () => clearTimeout(t));
  });
  next();
};

async function kick(id: string) {
  if (!env.SUBMISSIONS_INLINE) return;
  // Modo inline (QA local sem PM2): processa dentro deste processo, fora do ciclo da requisição.
  setImmediate(() => {
    void import("./process.js")
      .then((m) => m.processSubmission(id))
      .catch((e) => console.error("[submissions] processamento inline falhou:", e));
  });
}

const handler: RequestHandler = async (req, res) => {
  const wallet = req.wallet!;
  const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, wallet));
  const notReady = creatorNotReady(creator);
  if (notReady) {
    throw forbidden(notReady);
  }

  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ZIP_TYPES.has(type)) {
    throw err(415, "Envie o ZIP como corpo cru com Content-Type: application/zip.", "unsupported_media_type");
  }

  const resubmit = typeof req.query.resubmit === "string" ? req.query.resubmit : undefined;
  let existing: typeof schema.packageSubmissions.$inferSelect | undefined;
  if (resubmit !== undefined) {
    if (!SUBMISSION_ID_RE.test(resubmit)) throw err(400, "Identificador de envio inválido.", "bad_request");
    [existing] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, resubmit));
    if (!existing || existing.creatorWallet !== wallet) throw err(404, "Envio não encontrado.", "not_found");
    if (!canResubmit(existing.status)) throw err(409, "Só dá para reenviar um pacote em que o revisor pediu mudanças.", "not_resubmittable", { status: existing.status });
  } else {
    const limited = uploadLimitProblem(await uploadCounts(wallet), { maxPending: env.SUBMISSION_MAX_PENDING, maxPerDay: env.SUBMISSION_MAX_PER_DAY });
    if (limited) throw err(429, limited.message, limited.code);
  }

  const max = env.SUBMISSION_MAX_ZIP_BYTES;
  const declared = req.headers["content-length"] === undefined ? undefined : Number(req.headers["content-length"]);
  if (declared !== undefined && (!Number.isFinite(declared) || declared < 0)) throw err(400, "Content-Length inválido.", "bad_request");
  if (declared !== undefined && declared > max) {
    throw err(413, `O ZIP passa do limite de ${Math.floor(max / (1024 * 1024))} MB.`, "payload_too_large", { maxBytes: max });
  }
  if (declared === 0) throw err(400, "O corpo da requisição está vazio.", "empty_body");

  const id = existing?.id ?? randomId(12);
  const dir = submissionDir(id);
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const part = `${zipPathOf(id)}.part`;
  const cleanup = async () => {
    await rm(part, { force: true });
    if (!existing) await rm(dir, { recursive: true, force: true });
  };
  let size: number;
  try {
    await rm(part, { force: true });
    size = await receiveBody(req, part, max);
    if (size === 0) throw err(400, "O corpo da requisição está vazio.", "empty_body");
    if (!looksLikeZip(part)) throw err(400, "O arquivo enviado não é um ZIP.", "not_a_zip");
  } catch (e) {
    await cleanup();
    throw e;
  }

  // Resubmissão: o ZIP novo substitui o antigo (rename atômico) e só então a linha volta a `validating`.
  if (existing) {
    await rename(part, zipPathOf(id));
    const upd = await db
      .update(schema.packageSubmissions)
      .set({ status: "validating", sizeBytes: size, zipPath: zipRelPath(id), manifest: null, validation: null, scans: null, error: null, updatedAt: new Date() })
      .where(and(eq(schema.packageSubmissions.id, id), eq(schema.packageSubmissions.status, "changes_requested")))
      .returning({ id: schema.packageSubmissions.id });
    if (upd.length === 0) throw err(409, "Este envio não aceita mais um ZIP novo.", "not_resubmittable");
    await notifyAdmin(adminMessage("resubmitted", { id, slug: existing.slug, version: existing.version, creatorWallet: wallet, name: (existing.manifest?.name as string | undefined) ?? null }));
    void kick(id);
    res.status(202).json({ id, status: "validating" });
    return;
  }

  try {
    await rename(part, zipPathOf(id));
    // Recontagem sob trava por criador: dois uploads simultâneos não furam o limite de pendentes.
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`creator-upload:${wallet}`}, 0))`);
      const mine = eq(schema.packageSubmissions.creatorWallet, wallet);
      const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.packageSubmissions).where(and(mine, inArray(schema.packageSubmissions.status, [...SUBMISSION_OPEN_STATUSES])));
      const [d] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.packageSubmissions).where(and(mine, gt(schema.packageSubmissions.createdAt, sql`now() - interval '24 hours'`)));
      const limited = uploadLimitProblem({ pending: p?.n ?? 0, last24h: d?.n ?? 0 }, { maxPending: env.SUBMISSION_MAX_PENDING, maxPerDay: env.SUBMISSION_MAX_PER_DAY });
      if (limited) throw err(429, limited.message, limited.code);
      // slug, versão e agentId definitivos só se conhecem depois de abrir o ZIP: o worker os preenche.
      await tx.insert(schema.packageSubmissions).values({ id, creatorWallet: wallet, agentId: randomId(16), slug: "", version: "", status: "submitted", zipPath: zipRelPath(id), sizeBytes: size });
    });
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  await notifyAdmin(adminMessage("submitted", { id, slug: "", version: "", creatorWallet: wallet }));
  void kick(id);
  res.status(202).json({ id, status: "submitted" });
};

/** Cadeia da rota: cookie -> login -> handler. O CORS e o limite por IP vêm de app.ts (onde o `webCors` e o `byIp` existem). */
export const submissionUploadHandlers: RequestHandler[] = [closeUnreadBody, cookieParser(), requireAuth, handler];

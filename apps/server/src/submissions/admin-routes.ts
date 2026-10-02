import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AdminReviewInput, SubmissionStatus, type AdminSubmissionDetail, type AdminSubmissionRow, type SubmissionFileEntry } from "@solvers/shared";
import { requireAuth } from "../auth/jwt.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { searchKnowledgeInVersion } from "../knowledge/ingest.js";
import { badRequest, forbidden, h, HttpError, notFound, parse } from "../lib/http.js";
import { PackagePathError, resolveInsidePackage } from "../runtime/package-paths.js";
import { packageFromFolder } from "../runtime/validate/input.js";
import { isNewAgent, newAgentSet } from "./lookup.js";
import { extractedDirOf, stagingVersion, SUBMISSION_ID_RE } from "./paths.js";
import { approveSubmission, rejectSubmission, requestChanges } from "./review.js";
import { differentiatorsOf, isAdminWallet, reviewPathProblem, toAdminRow, toSubmissionView } from "./rules.js";

// Revisão no site (PACKAGE_SPEC.md 14.4 e 14.5). Admin = carteira em ADMIN_WALLETS, confirmada pelo login.
// A tela de revisão é o alvo mais valioso (quem aprova publica): toda resposta é JSON de TEXTO, sem HTML, com
// `nosniff` e sem cache; o que o criador escreveu nunca é devolvido como página.

export const adminRouter: Router = Router();

function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!isAdminWallet(req.wallet, env.ADMIN_WALLETS)) return next(forbidden("Só administradores revisam pacotes."));
  next();
}

function noSniff(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
}

adminRouter.use("/admin", noSniff, requireAuth, requireAdmin);

const idParam = (req: Request): string => {
  const id = String(req.params.id ?? "");
  if (!SUBMISSION_ID_RE.test(id)) throw notFound("Submissão não encontrada.");
  return id;
};

async function loadRow(id: string) {
  const [row] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
  if (!row) throw notFound("Submissão não encontrada.");
  return row;
}

// ---------------------------------------------------------------------------------------------------------------
// Fila

adminRouter.get(
  "/admin/submissions",
  h(async (req): Promise<AdminSubmissionRow[]> => {
    const raw = typeof req.query.status === "string" ? req.query.status : undefined;
    const status = raw === undefined ? undefined : parse(SubmissionStatus, raw);
    const rows = await db
      .select({ s: schema.packageSubmissions, wallet: schema.creators.wallet, creatorName: schema.creators.name })
      .from(schema.packageSubmissions)
      .leftJoin(schema.creators, eq(schema.creators.wallet, schema.packageSubmissions.creatorWallet))
      .where(status ? eq(schema.packageSubmissions.status, status) : undefined)
      // Fila de revisão: a mais antiga primeiro. As outras listas: a mais recente primeiro.
      .orderBy(status === "pending_review" ? schema.packageSubmissions.createdAt : desc(schema.packageSubmissions.createdAt))
      .limit(200);
    const fresh = await newAgentSet([...new Set(rows.map((r) => r.s.agentId))]);
    return rows.map((r) => toAdminRow(r.s, { wallet: r.wallet ?? r.s.creatorWallet, name: r.creatorName ?? null }, fresh.has(r.s.agentId)));
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Prévia

async function knowledgeSummary(agentId: string, submissionId: string): Promise<AdminSubmissionDetail["knowledge"]> {
  const version = stagingVersion(submissionId);
  const k = schema.knowledgeChunks;
  const [c] = await db
    .select({
      files: sql<number>`count(distinct ${k.source})::int`,
      chunks: sql<number>`count(*)::int`,
      expired: sql<number>`count(*) filter (where ${k.validUntil} is not null and ${k.validUntil} < current_date)::int`,
    })
    .from(k)
    .where(and(eq(k.agentId, agentId), eq(k.version, version)));
  const [job] = await db.select({ status: schema.ingestJobs.status }).from(schema.ingestJobs).where(eq(schema.ingestJobs.submissionId, submissionId));
  const ingest = job && ["queued", "running", "done", "failed"].includes(job.status) ? (job.status as "queued" | "running" | "done" | "failed") : "none";
  return { files: c?.files ?? 0, chunks: c?.chunks ?? 0, expiredChunks: c?.expired ?? 0, ingest };
}

function filesOf(id: string, scans: Record<string, unknown> | null): SubmissionFileEntry[] {
  const diff = (scans as { diff?: { files?: SubmissionFileEntry[] } } | null)?.diff;
  if (diff?.files) return diff.files;
  // Sem diff gravado (ainda validando): lista o que existe na pasta, tudo como novo.
  const dir = extractedDirOf(id);
  if (!existsSync(dir)) return [];
  return packageFromFolder(dir).entries.map((e) => ({ path: e.path, size: e.size, diff: "added" as const }));
}

adminRouter.get(
  "/admin/submissions/:id",
  h(async (req): Promise<AdminSubmissionDetail> => {
    const row = await loadRow(idParam(req));
    const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, row.creatorWallet));
    const fresh = await isNewAgent(row.agentId);
    const reviews = await db.select().from(schema.packageReviews).where(eq(schema.packageReviews.submissionId, row.id)).orderBy(schema.packageReviews.id);
    return {
      submission: toSubmissionView(row, fresh),
      creator: { wallet: row.creatorWallet, name: creator?.name ?? null, bio: creator?.bio ?? null, contactVerified: creator?.telegramChatId != null },
      isNewAgent: fresh,
      manifest: row.manifest,
      validation: (row.validation as AdminSubmissionDetail["validation"]) ?? null,
      scans: row.scans,
      files: filesOf(row.id, row.scans),
      knowledge: await knowledgeSummary(row.agentId, row.id),
      differentiators: differentiatorsOf(row.manifest, row.validation),
      reviews: reviews.map((r) => ({ id: r.id, reviewerWallet: r.reviewerWallet, action: r.action, notes: r.notes, checklist: r.checklist, createdAt: r.createdAt.toISOString() })),
    };
  }),
);

/** Conteúdo de um arquivo do pacote extraído, como JSON de texto: `{ path, content }`. */
adminRouter.get(
  "/admin/submissions/:id/file",
  h(async (req) => {
    const id = idParam(req);
    await loadRow(id);
    const path = req.query.path;
    const why = reviewPathProblem(path);
    if (why) throw badRequest(`Caminho inválido: ${why}`, "bad_path");
    const rel = path as string;
    let real: string;
    try {
      real = resolveInsidePackage(extractedDirOf(id), rel, [""]);
    } catch (e) {
      if (e instanceof PackagePathError) throw notFound("Arquivo não encontrado no pacote.");
      throw e;
    }
    if (statSync(real).size > env.SUBMISSION_MAX_UNZIPPED_BYTES) throw new HttpError(413, "Arquivo grande demais para a prévia.", "payload_too_large");
    return { path: rel, content: await readFile(real, "utf8") };
  }),
);

adminRouter.get(
  "/admin/submissions/:id/knowledge-search",
  h(async (req) => {
    const id = idParam(req);
    const row = await loadRow(id);
    const q = parse(z.string().trim().min(3).max(200), req.query.q);
    const hits = await searchKnowledgeInVersion(row.agentId, stagingVersion(id), q, 5);
    return { query: q, hits };
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Decisões (motivo obrigatório; aprovar exige o checklist inteiro)

const ctxOf = (req: Request) => ({ id: idParam(req), reviewerWallet: req.wallet!, ip: req.ip, input: parse(AdminReviewInput, req.body) });

adminRouter.post("/admin/submissions/:id/approve", h((req) => approveSubmission(ctxOf(req))));
adminRouter.post("/admin/submissions/:id/request-changes", h((req) => requestChanges(ctxOf(req))));
adminRouter.post("/admin/submissions/:id/reject", h((req) => rejectSubmission(ctxOf(req))));

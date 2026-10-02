import { existsSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import type { AdminReviewInput } from "@solvers/shared";
import { db, schema } from "../db/index.js";
import { deleteKnowledgeVersion } from "../knowledge/ingest.js";
import { HttpError } from "../lib/http.js";
import { packageHashOf } from "../review/hash.js";
import { packageFromFolder } from "../runtime/validate/input.js";
import { minPriceUnits } from "./lookup.js";
import { creatorMessage, notifyCreatorWallet } from "./notify.js";
import { extractedDirOf, stagingVersion } from "./paths.js";
import { planApproval, reviewTransitionProblem, REVIEW_TRANSITIONS, type Approved } from "./rules.js";

// Decisões do revisor sobre uma submissão em `pending_review` (PACKAGE_SPEC.md 14.4 e 15.3). Cada ação respeita
// `canTransition`, é condicional ao estado atual (duas decisões simultâneas não passam as duas) e deixa uma linha em
// `package_reviews`, que é somente-inserção (trigger do banco). Aprovar no site NÃO assina nada on-chain.

type Row = typeof schema.packageSubmissions.$inferSelect;

export type ReviewCtx = {
  id: string;
  reviewerWallet: string;
  ip: string | undefined;
  input: AdminReviewInput;
};

export type ReviewDeps = {
  minPriceUnits: () => Promise<bigint>;
  notifyCreator: (wallet: string, text: string) => Promise<void>;
  deleteStaging: (agentId: string, version: string) => Promise<number>;
  /** Só para testes: acompanha a ordem das gravações da aprovação. */
  trace?: (step: "published_version" | "submission" | "review") => void;
};

export const defaultReviewDeps: ReviewDeps = { minPriceUnits, notifyCreator: notifyCreatorWallet, deleteStaging: deleteKnowledgeVersion };

const subjectOf = (r: Row) => ({ id: r.id, slug: r.slug, version: r.version, creatorWallet: r.creatorWallet, name: (r.manifest?.name as string | undefined) ?? null });

async function load(id: string): Promise<Row> {
  const [row] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
  if (!row) throw new HttpError(404, "Submissão não encontrada.", "not_found");
  return row;
}

/** Trava a linha e confere que o estado ainda é o esperado (outra decisão pode ter chegado antes). */
async function lockPending(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string): Promise<Row> {
  await tx.execute(sql`select id from package_submissions where id = ${id} for update`);
  const [row] = await tx.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
  if (!row) throw new HttpError(404, "Submissão não encontrada.", "not_found");
  return row;
}

/**
 * Aprova: congela hash, preço, royalty, nome e versão em `package_submissions.approved` e muda para
 * `awaiting_creator_signature`. A versão aprovada entra em `agent_published_versions` ANTES de qualquer outra gravação:
 * o `/tx/submit` indexa a transação do criador na hora, e o indexador compararia a cadeia com uma linha que ainda não existia.
 */
export async function approveSubmission(ctx: ReviewCtx, deps: ReviewDeps = defaultReviewDeps): Promise<{ id: string; status: "awaiting_creator_signature"; approved: Approved }> {
  const row = await load(ctx.id);
  const bad = reviewTransitionProblem(row.status, "approve");
  if (bad) throw new HttpError(409, bad, "invalid_state");
  const dir = extractedDirOf(ctx.id);
  if (!existsSync(dir)) throw new HttpError(409, "Os arquivos extraídos desta submissão não existem mais no servidor.", "files_missing");

  // O hash é calculado AQUI, sobre a pasta que o revisor viu: é o `versionHash` que vai on-chain.
  const versionHash = packageHashOf(packageFromFolder(dir));
  const plan = planApproval({ status: row.status, validation: row.validation, manifest: row.manifest, checklist: ctx.input.checklist, versionHash, minPriceUnits: await deps.minPriceUnits() });
  if (!plan.ok) throw new HttpError(plan.status, plan.message, plan.code);

  // O catálogo já serve essa versão: aprovar de novo sobrescreveria o hash de uma versão em produção.
  const [live] = await db.select({ version: schema.agents.version }).from(schema.agents).where(eq(schema.agents.id, row.agentId));
  if (live && live.version === plan.approved.version) {
    throw new HttpError(409, `A versão ${live.version} deste Solver já está publicada. Peça ao criador para subir a versão.`, "version_already_published");
  }

  await db.transaction(async (tx) => {
    const fresh = await lockPending(tx, ctx.id);
    const problem = reviewTransitionProblem(fresh.status, "approve");
    if (problem) throw new HttpError(409, problem, "invalid_state");

    // 1) versão aprovada: antes de qualquer outra coisa.
    deps.trace?.("published_version");
    await tx
      .insert(schema.agentPublishedVersions)
      .values({ agentId: fresh.agentId, version: plan.approved.version, versionHash, priceUsdc: plan.priceUnits })
      .onConflictDoUpdate({
        target: [schema.agentPublishedVersions.agentId, schema.agentPublishedVersions.version],
        set: { versionHash, priceUsdc: plan.priceUnits, approvedAt: new Date(), approveTx: null },
      });
    // 2) submissão: dados congelados e novo estado.
    deps.trace?.("submission");
    await tx
      .update(schema.packageSubmissions)
      .set({ approved: plan.approved, status: REVIEW_TRANSITIONS.approve.to, reviewerNotes: ctx.input.notes, error: null, updatedAt: new Date() })
      .where(and(eq(schema.packageSubmissions.id, ctx.id), eq(schema.packageSubmissions.status, "pending_review")));
    // 3) trilha de auditoria (somente-inserção).
    deps.trace?.("review");
    await tx.insert(schema.packageReviews).values({
      submissionId: ctx.id,
      reviewerWallet: ctx.reviewerWallet,
      action: "approve",
      notes: ctx.input.notes,
      checklist: ctx.input.checklist,
      versionHash,
      diffSnapshot: ((row.scans as { diff?: Record<string, unknown> } | null)?.diff as Record<string, unknown> | undefined) ?? null,
      ip: ctx.ip ?? null,
    });
  });
  await deps.notifyCreator(row.creatorWallet, creatorMessage("approved", subjectOf(row)));
  return { id: ctx.id, status: "awaiting_creator_signature", approved: plan.approved };
}

async function decide(action: "request_changes" | "reject", ctx: ReviewCtx, deps: ReviewDeps): Promise<{ id: string; status: "changes_requested" | "rejected" }> {
  const row = await load(ctx.id);
  const to = REVIEW_TRANSITIONS[action].to;
  const bad = reviewTransitionProblem(row.status, action);
  if (bad) throw new HttpError(409, bad, "invalid_state");
  await db.transaction(async (tx) => {
    const fresh = await lockPending(tx, ctx.id);
    const problem = reviewTransitionProblem(fresh.status, action);
    if (problem) throw new HttpError(409, problem, "invalid_state");
    await tx
      .update(schema.packageSubmissions)
      .set({ status: to, reviewerNotes: ctx.input.notes, updatedAt: new Date() })
      .where(and(eq(schema.packageSubmissions.id, ctx.id), eq(schema.packageSubmissions.status, fresh.status)));
    await tx.insert(schema.packageReviews).values({
      submissionId: ctx.id,
      reviewerWallet: ctx.reviewerWallet,
      action,
      notes: ctx.input.notes,
      checklist: ctx.input.checklist,
      versionHash: null,
      diffSnapshot: null,
      ip: ctx.ip ?? null,
    });
  });
  // Recusa definitiva: o conhecimento de teste não serve mais a ninguém.
  if (to === "rejected") await deps.deleteStaging(row.agentId, stagingVersion(ctx.id)).catch((e) => console.warn("[submissions] limpeza do staging falhou:", (e as Error).message));
  await deps.notifyCreator(row.creatorWallet, creatorMessage(to === "rejected" ? "rejected" : "changes_requested", subjectOf(row), ctx.input.notes));
  return { id: ctx.id, status: to };
}

export const requestChanges = (ctx: ReviewCtx, deps: ReviewDeps = defaultReviewDeps) => decide("request_changes", ctx, deps) as Promise<{ id: string; status: "changes_requested" }>;
export const rejectSubmission = (ctx: ReviewCtx, deps: ReviewDeps = defaultReviewDeps) => decide("reject", ctx, deps) as Promise<{ id: string; status: "rejected" }>;

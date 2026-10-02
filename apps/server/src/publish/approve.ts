import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { FINALIZABLE_STATUSES, nextPublicationStep, parseApproved, type PublicationStep } from "./approval-rules.js";
import { publishChain, type PublishChain } from "./chain-port.js";
import { finalizePublication, type FinalizeDeps, type FinalizeResult } from "./finalize.js";

// Aprovação on-chain do admin (PACKAGE_SPEC.md 15.2 e 15.3, passos 4 e 5): só Solver novo. O `approve_agent` exige o admin
// on-chain, que é uma carteira fria fora da VPS (ADMIN_KEYPAIR só existe na máquina do time): "Aprovar" no site apenas
// libera, e quem assina o `approve_agent` é este comando (`cli:approve <slug|submissionId>`). Depois, dispara a finalização.

type SubmissionRow = typeof schema.packageSubmissions.$inferSelect;

export class ApproveError extends Error {}

/** Resolve `<slug|submissionId>` para a submissão que espera a cadeia (a mais recente, se for um slug). */
export async function resolveSubmission(ref: string): Promise<SubmissionRow> {
  const t = schema.packageSubmissions;
  const [byId] = await db.select().from(t).where(eq(t.id, ref));
  if (byId) return byId;
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.slug, ref), inArray(t.status, [...FINALIZABLE_STATUSES])))
    .orderBy(desc(t.createdAt));
  if (rows.length === 0) throw new ApproveError(`nenhuma submissão esperando publicação para "${ref}" (use o slug ou o id da submissão)`);
  if (rows.length > 1) {
    throw new ApproveError(`"${ref}" tem ${rows.length} submissões em andamento (${rows.map((r) => `${r.id} v${r.version} ${r.status}`).join("; ")}). Informe o id da submissão.`);
  }
  return rows[0]!;
}

export type ApproveResult = {
  submissionId: string;
  slug: string;
  version: string;
  /** Falta o quê (a cadeia ainda não está como o aprovado) ou `null` quando foi até o fim. */
  step: PublicationStep;
  /** Assinatura do approve_agent (null: já estava aprovado na cadeia, ou dry-run). */
  approveTx: string | null;
  dryRun: boolean;
  finalize: FinalizeResult | null;
};

/**
 * Assina o `approve_agent` do Solver novo da submissão e finaliza a publicação. Recusa quando a cadeia não bate com a
 * versão aprovada (nunca aprova o que a revisão não viu) ou quando a chave local não é o admin on-chain.
 */
export async function approveOnChain(
  ref: string,
  opts: { port?: PublishChain; dryRun?: boolean; deps?: Partial<FinalizeDeps> } = {},
): Promise<ApproveResult> {
  const port = opts.port ?? publishChain();
  const sub = await resolveSubmission(ref);
  const approved = parseApproved(sub.approved);
  if (!approved) throw new ApproveError(`a submissão ${sub.id} não tem versão aprovada pela revisão`);
  if (!FINALIZABLE_STATUSES.includes(sub.status as (typeof FINALIZABLE_STATUSES)[number])) {
    throw new ApproveError(`a submissão ${sub.id} está em "${sub.status}"; só se aprova on-chain quem espera a publicação`);
  }
  const base = { submissionId: sub.id, slug: sub.slug, version: approved.version, dryRun: opts.dryRun === true };
  const step = nextPublicationStep(approved, await port.fetchAgentState(sub.agentId));

  if (step === "ready") {
    // Já Active na cadeia (aprovado antes, por outro caminho): só falta finalizar.
    if (opts.dryRun) return { ...base, step, approveTx: null, finalize: null };
    const actor = (await port.adminAddress()) ?? undefined;
    return { ...base, step, approveTx: null, finalize: await finalizePublication(sub.id, { actor, deps: { port, ...opts.deps } }) };
  }
  if (step !== "await-admin-approval") {
    throw new ApproveError(`a cadeia ainda não está como o aprovado (falta: ${step}). O criador precisa concluir a assinatura no site antes.`);
  }

  const admin = await port.adminAddress();
  if (!admin) throw new ApproveError("ADMIN_KEYPAIR não configurada: o approve_agent exige a carteira do admin on-chain");
  const onchain = await port.onchainAdmin();
  if (onchain !== admin) throw new ApproveError(`a chave local (${admin}) não é o admin on-chain (${onchain})`);
  if (opts.dryRun) return { ...base, step, approveTx: null, finalize: null };

  const approveTx = await port.approveAgent(sub.agentId);
  const t = schema.packageSubmissions;
  await db.update(t).set({ approveTx, updatedAt: new Date() }).where(and(eq(t.id, sub.id), isNull(t.approveTx)));
  const v = schema.agentPublishedVersions;
  await db.update(v).set({ approveTx }).where(and(eq(v.agentId, sub.agentId), eq(v.version, approved.version), isNull(v.approveTx)));
  // Espelha o novo status (Active) já; o evento AgentStatusChanged do indexador faria o mesmo e é idempotente.
  await port.indexSignature(approveTx).catch(() => undefined);
  return { ...base, step, approveTx, finalize: await finalizePublication(sub.id, { actor: admin, deps: { port, ...opts.deps } }) };
}

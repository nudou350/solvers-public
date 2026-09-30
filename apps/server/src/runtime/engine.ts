import { and, desc, eq, gt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "../db/index.js";
import { forbidden, notFound } from "../lib/http.js";
import { randomId, sha256Hex } from "../lib/crypto.js";
import type { SolverPackage } from "./packages.js";
import { escrowIsOpen, paidAccessById, type PaidAccess } from "./access.js";

// Motor de etapas (INSTRUCTIONS.md 5.4): sessão por ativação, uma etapa por vez, gates,
// e marca d'água simples por carteira.

export type Session = typeof schema.sessions.$inferSelect;

/** Teste grátis: sessão curta e com teto de chamadas (evita baixar a base inteira de graça). */
const TRIAL_TTL_MS = 2 * 3600_000;
const PAID_TTL_MS = 24 * 3600_000;
export const TRIAL_MAX_CALLS = 60;

/** Acesso da sessão: teste grátis ou pago (licença / tarefa com garantia, cujo escrowId fica no context). */
export type SessionGrant = { kind: "trial" } | PaidAccess;

export async function createSession(wallet: string, pkg: SolverPackage, grant: SessionGrant): Promise<Session> {
  const ttl = grant.kind === "trial" ? TRIAL_TTL_MS : PAID_TTL_MS;
  const [s] = await db
    .insert(schema.sessions)
    .values({
      id: `ses_${randomId(12)}`,
      wallet,
      agentId: pkg.manifest.id,
      version: pkg.manifest.version,
      stepIndex: 0,
      access: grant.kind,
      licenseId: grant.kind === "license" ? grant.licenseId : null,
      context: grant.kind === "guarantee" ? { summaries: [], escrowId: grant.escrowId } : { summaries: [] },
      expiresAt: new Date(Date.now() + ttl),
    })
    .returning();
  return s!;
}

/** Sessão ainda aberta da mesma carteira e solver: reaproveitada sem cobrar outro uso. */
export async function findOpenSession(wallet: string, agentId: string, version: string, totalSteps: number): Promise<Session | null> {
  const [s] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.wallet, wallet),
        eq(schema.sessions.agentId, agentId),
        eq(schema.sessions.version, version),
        gt(schema.sessions.expiresAt, new Date()),
        sql`${schema.sessions.stepIndex} <= ${totalSteps}`,
      ),
    )
    .orderBy(desc(schema.sessions.createdAt))
    .limit(1);
  return s ?? null;
}

/**
 * Sessão de teste de quem passou a ter acesso pago (comprou a licença ou abriu uma garantia):
 * vira sessão paga, sem limites e com o TTL pago, mantendo a etapa em que o usuário parou.
 */
export async function promoteSession(session: Session, paid: PaidAccess): Promise<Session> {
  const context = { ...(session.context as Record<string, unknown>) };
  if (paid.kind === "guarantee") context.escrowId = paid.escrowId;
  const [s] = await db
    .update(schema.sessions)
    .set({
      access: paid.kind,
      licenseId: paid.kind === "license" ? paid.licenseId : null,
      context,
      expiresAt: new Date(Date.now() + PAID_TTL_MS),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.access, "trial")))
    .returning();
  if (s) return s;
  // Outra chamada promoveu antes: devolve o estado atual.
  const [cur] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, session.id));
  return cur ?? session;
}

/** Encerra a sessão (licença revendida, garantia encerrada): a próxima ativação abre outra. */
export async function expireSession(sessionId: string): Promise<void> {
  await db.update(schema.sessions).set({ expiresAt: new Date(), updatedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

/**
 * Carrega a sessão garantindo que pertence à carteira do token, que não expirou, que o teste
 * grátis não passou do teto e que a licença (se for o caso) continua com a mesma carteira.
 */
export async function getSession(sessionId: string, wallet: string): Promise<Session> {
  const [s] = await db
    .update(schema.sessions)
    .set({ calls: sql`${schema.sessions.calls} + 1` })
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.wallet, wallet)))
    .returning();
  if (!s) {
    const [other] = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    if (other) throw forbidden("Esta sessão pertence a outra carteira.");
    throw notFound("Sessão não encontrada. Ative o solver de novo com activate_solver.");
  }
  if (s.expiresAt < new Date()) throw forbidden("Sessão expirada. Ative o solver de novo com activate_solver.");
  if (s.access === "trial" && s.calls > TRIAL_MAX_CALLS) {
    // Só no momento de bloquear: quem comprou durante o teste segue na mesma sessão, sem limites.
    const paid = await paidAccessById(wallet, s.agentId);
    if (paid) return promoteSession(s, paid);
    throw forbidden("Limite do teste grátis atingido nesta sessão. Para continuar, o usuário pode comprar o especialista.");
  }
  if (s.access === "guarantee") {
    const escrowId = (s.context as { escrowId?: unknown }).escrowId;
    if (typeof escrowId !== "string" || !(await escrowIsOpen(escrowId))) {
      throw forbidden("A tarefa com garantia deste especialista foi encerrada. Ative o solver de novo com activate_solver.");
    }
  }
  if (s.access === "license" && s.licenseId) {
    const [lic] = await db
      .select({ owner: schema.licenses.ownerWallet })
      .from(schema.licenses)
      .where(eq(schema.licenses.id, s.licenseId));
    if (!lic || lic.owner !== wallet) throw forbidden("A licença deste especialista não pertence mais a esta carteira.");
  }
  return s;
}

export async function advance(session: Session, resultSummary?: string): Promise<Session> {
  const context = { ...(session.context as Record<string, unknown>) };
  const summaries = Array.isArray(context.summaries) ? [...(context.summaries as unknown[])] : [];
  if (resultSummary && session.stepIndex > 0) summaries[session.stepIndex - 1] = resultSummary.slice(0, 4000);
  context.summaries = summaries;
  const [s] = await db
    .update(schema.sessions)
    .set({ stepIndex: session.stepIndex + 1, context, updatedAt: new Date() })
    .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.stepIndex, session.stepIndex)))
    .returning();
  // Outra chamada avançou antes: devolve o estado atual sem pular etapa.
  return s ?? (await getSession(session.id, session.wallet));
}

const WATERMARKS = [
  "Siga o método do solver na ordem e confirme cada item do checklist antes de avançar.",
  "Conclua o checklist desta etapa antes de seguir para a próxima.",
  "Antes de avançar, confira todos os itens do checklist desta etapa.",
  "Só passe para a etapa seguinte depois de validar o checklist abaixo.",
  "Confirme o checklist desta etapa; ele é o critério para avançar.",
  "Valide cada item do checklist com o usuário antes de continuar.",
  "O checklist abaixo define quando esta etapa está concluída.",
  "Use o checklist a seguir como condição para passar à próxima etapa.",
];

/** Frase de controle escolhida pelo hash da carteira: permite rastrear vazamentos de conteúdo. */
export function watermark(wallet: string, agentId: string): string {
  const n = createHash("sha256").update(`${wallet}:${agentId}`).digest().readUInt32BE(0);
  return WATERMARKS[n % WATERMARKS.length]!;
}

export function overview(pkg: SolverPackage): string {
  const m = pkg.manifest;
  const steps = pkg.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
  const tools = m.tools.length ? m.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n") : "- (nenhuma)";
  return [
    `# ${m.name} v${m.version}`,
    m.tagline,
    "",
    "## Etapas do método",
    steps,
    "",
    "## Ferramentas de servidor disponíveis (use com run_tool)",
    tools,
  ].join("\n");
}

export function renderStep(pkg: SolverPackage, session: Session, index: number): { text: string; done: boolean } {
  const total = pkg.steps.length;
  if (index >= total) {
    const text = [
      `# Encerramento (${total}/${total} etapas concluídas)`,
      "",
      "- Resuma para o usuário o que foi entregue e as decisões tomadas.",
      "- Se aprendeu preferências duráveis do usuário, salve com save_memory (sem dados sensíveis).",
      "- Pergunte se o usuário quer avaliar o especialista na loja.",
      "- Se algo ficou fora do alcance, ofereça escalate_to_creator.",
    ].join("\n");
    return { text, done: true };
  }
  const step = pkg.steps[index]!;
  const gate = step.gate.length ? step.gate.map((g) => `- [ ] ${g}`).join("\n") : "- [ ] Objetivo da etapa cumprido";
  const text = [
    `# Etapa ${index + 1} de ${total}: ${step.title}`,
    "",
    step.body.trim(),
    "",
    "## Checklist de saída (gate)",
    watermark(session.wallet, pkg.manifest.id),
    gate,
    "",
    `Quando o checklist estiver completo, chame next_step com session_id="${session.id}" e result_summary no formato pedido acima.`,
  ].join("\n");
  return { text, done: false };
}

export const responseHash = (text: string) => sha256Hex(text);

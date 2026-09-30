import { badRequest, HttpError } from "../lib/http.js";

// Regras puras das sessões do conector (sem env/banco), testadas em test/session.test.ts.

/** A sessão é de uma versão antiga do especialista: conteúdo e base de conhecimento não combinam mais. */
export function assertSessionCurrent(sessionVersion: string, currentVersion: string, name: string): void {
  if (sessionVersion === currentVersion) return;
  throw new HttpError(
    409,
    `${name} foi atualizado (v${sessionVersion} para v${currentVersion}) e esta sessão ficou desatualizada. Chame activate_solver de novo para abrir uma sessão na versão atual.`,
    "session_outdated",
  );
}

export type NextStepPlan = { kind: "advance"; index: number } | { kind: "replay"; index: number };

/**
 * next_step com `completed_step` (quantas etapas a IA já concluiu; 0 no começo). Sessão com
 * `stepIndex` = etapas já entregues:
 * - ausente ou igual: avança (comportamento de sempre);
 * - menor: a resposta anterior se perdeu e a IA repete a chamada; reenvia a etapa sem avançar;
 * - maior: a IA diz ter concluído etapas que não recebeu.
 */
export function planNextStep(stepIndex: number, completedStep?: number): NextStepPlan {
  if (completedStep === undefined || completedStep === stepIndex) return { kind: "advance", index: stepIndex };
  if (completedStep > stepIndex) {
    throw badRequest(`completed_step=${completedStep} é maior que as etapas já entregues (${stepIndex}). Use o número da última etapa que você concluiu.`, "invalid_completed_step");
  }
  return { kind: "replay", index: completedStep };
}

/** Grava o resumo da etapa `slot` (0-based) no contexto, sem mexer nos demais. */
export function withSummary(context: Record<string, unknown>, slot: number, summary: string): Record<string, unknown> {
  const summaries = Array.isArray(context.summaries) ? [...(context.summaries as unknown[])] : [];
  if (slot >= 0) summaries[slot] = summary.slice(0, 4000);
  return { ...context, summaries };
}

/** Revalidação on-chain da licença de uma sessão: no máximo uma vez por janela curta. */
export const LICENSE_RECHECK_MS = 45_000;

export function licenseRecheckDue(lastCheckedAt: number | undefined, now: number, ttlMs = LICENSE_RECHECK_MS): boolean {
  return lastCheckedAt === undefined || now - lastCheckedAt >= ttlMs || now < lastCheckedAt;
}

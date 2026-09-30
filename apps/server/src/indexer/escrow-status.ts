// Regras do espelho do escrow quando a conta on-chain já não existe (funções puras).
// Espelham Escrow::refresh_status do programa (state.rs), com os nomes de status do banco.

export type MilestoneStatusName = "pending" | "passed" | "approved" | "disputed" | "refunded";
export type EscrowStatusName = "active" | "approved" | "disputed" | "refunded";

/** Status numérico do programa (enum MilestoneStatus) para o nome usado no banco. */
export const MILESTONE_STATUS: Record<number, MilestoneStatusName> = { 0: "pending", 1: "passed", 2: "approved", 3: "disputed", 4: "refunded" };

import { DISPUTE_SLA_SECS } from "../store/delivery-rules.js";

/**
 * A disputa passou do prazo de julgamento e o comprador deve ser reembolsado (resolve_stale_dispute)?
 * Regras do programa: etapa que NUNCA passou nos testes (passed_at == 0), prazo de entrega vencido
 * (now > delivery_deadline) e disputed_at + 7 dias. Etapa que já passou nos testes só o admin julga.
 * Todos em unix (segundos) como na conta on-chain; 0 = ausente.
 */
export function staleDisputeDue(
  m: { disputedAt: bigint | number; passedAt: bigint | number; deliveryDeadline: bigint | number },
  nowSecs: number,
): boolean {
  const disputedAt = Number(m.disputedAt);
  return disputedAt > 0 && Number(m.passedAt) === 0 && nowSecs > Number(m.deliveryDeadline) && nowSecs >= disputedAt + DISPUTE_SLA_SECS;
}

const isTerminal = (s: string) => s === "approved" || s === "refunded";

/** Recalcula o status do escrow pelas etapas (igual ao refresh_status do programa). */
export function escrowStatusFromMilestones(statuses: readonly string[]): EscrowStatusName {
  if (statuses.length > 0 && statuses.every((s) => s === "refunded")) return "refunded";
  if (statuses.length > 0 && statuses.every(isTerminal)) return "approved";
  if (statuses.some((s) => s === "disputed")) return "disputed";
  return "active";
}

/**
 * Um evento atrasado não pode desfazer um desfecho: etapa já aprovada/reembolsada só muda para outro
 * estado final (o evento de resolução vence um "disputed" antigo, nunca o contrário).
 */
export function canApplyMilestoneStatus(current: string, incoming: MilestoneStatusName): boolean {
  return isTerminal(incoming) || !isTerminal(current);
}

/**
 * Status do escrow quando a conta já foi fechada: close_escrow só aceita escrow concluído ou reembolsado,
 * então o resultado é sempre final. Se etapas irmãs estiverem defasadas no espelho (evento ainda não
 * indexado), o cálculo pode dar "active"/"disputed"; nesse caso vale o estado final mais comum, "approved".
 */
export function closedEscrowStatus(statuses: readonly string[]): "approved" | "refunded" {
  const s = escrowStatusFromMilestones(statuses);
  return s === "refunded" ? "refunded" : "approved";
}

/** O que a cadeia mostra de um escrow do banco: conta legível no layout v2, ausente ou em layout antigo. */
export type ChainVerdict = "ok" | "gone" | "legacy";

/**
 * O que cli:retire-escrows faz com um escrow aberto do banco (null = não mexe). Conta ausente/ilegível de tarefa
 * ainda ativa vira "refunded" e fechada; de tarefa já final só é marcada como fechada (se a conta sumiu).
 */
export function retirementPlan(status: string, v: ChainVerdict): { status?: "refunded"; closed: true } | null {
  if (v === "ok") return null;
  const final = status === "approved" || status === "refunded";
  if (final) return v === "gone" ? { closed: true } : null;
  return { status: "refunded", closed: true };
}

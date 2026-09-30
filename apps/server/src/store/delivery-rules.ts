import { badRequest } from "../lib/http.js";

// Regras puras de entrega e prazos (sem env/banco), testadas em test/guarantee.test.ts.
// As constantes espelham programs/solvers/src/state.rs; o programa on-chain é quem decide de fato.

export const DEFAULT_DELIVERY_DAYS = 14;
export const MAX_DELIVERY_DAYS = 60;
/** Prazo de julgamento de uma disputa de etapa que nunca passou nos testes (ver disputeDeadlineOf). */
export const DISPUTE_SLA_SECS = 7 * 86400;

/** Integridade do download da entrega aprovada: os arquivos em disco são os que foram verificados e aprovados? */
export function deliveryIntact(fileCount: number, actualHashHex: string, expectedHashHex: string | null): boolean {
  return fileCount > 0 && !!expectedHashHex && actualHashHex === expectedHashHex;
}

/** Prazo de entrega pedido na criação: ausente ou 0 vale o padrão; inteiro de 1 a MAX_DELIVERY_DAYS. */
export function resolveDeliveryDays(days: number | undefined): number {
  if (days === undefined || days === 0) return DEFAULT_DELIVERY_DAYS;
  if (!Number.isInteger(days) || days < 0 || days > MAX_DELIVERY_DAYS) {
    throw badRequest(`O prazo de entrega precisa ser de 1 a ${MAX_DELIVERY_DAYS} dias (ou omitido, para ${DEFAULT_DELIVERY_DAYS} dias).`, "invalid_delivery_days");
  }
  return days;
}

export const deliveryDeadlineFrom = (now: Date, days: number) => new Date(now.getTime() + days * 86400 * 1000);

/**
 * Até quando o comprador espera por um julgamento antes do reembolso automático de disputa parada.
 * O reembolso automático só vale para etapa que NUNCA passou nos testes (passedAt nulo) e exige o prazo de
 * entrega vencido E disputedAt + 7 dias: vale o mais tarde dos dois. Etapa que já passou nos testes e foi
 * contestada só o admin julga (nulo, sem reembolso automático). Nulo também sem disputa.
 */
export function disputeDeadlineOf(
  milestone: { disputedAt: Date | null | undefined; passedAt: Date | null | undefined },
  deliveryDeadline: Date | null | undefined,
): Date | null {
  if (!milestone.disputedAt || milestone.passedAt) return null;
  const sla = milestone.disputedAt.getTime() + DISPUTE_SLA_SECS * 1000;
  return new Date(deliveryDeadline ? Math.max(sla, deliveryDeadline.getTime()) : sla);
}

/** Etapa pendente, tarefa aberta e prazo de entrega vencido: o comprador pode cancelar e receber de volta. */
export function canCancelUndelivered(
  escrow: { closed: boolean; deliveryDeadline: Date | null },
  milestone: { status: string },
  now: Date,
): boolean {
  return !escrow.closed && milestone.status === "pending" && !!escrow.deliveryDeadline && now.getTime() > escrow.deliveryDeadline.getTime();
}

/** Data e hora em pt-BR (horário de Brasília), para mensagens ao usuário e à IA. */
export const formatDeadline = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Mensagem de por que a etapa não pode ser cancelada agora (null: pode). */
export function cancelUndeliveredBlock(
  escrow: { closed: boolean; deliveryDeadline: Date | null },
  milestone: { status: string },
  now: Date,
): string | null {
  if (escrow.closed) return "Esta tarefa já foi encerrada.";
  if (milestone.status !== "pending") return "Só dá para cancelar uma etapa que ainda não foi entregue.";
  if (!escrow.deliveryDeadline) return "Esta tarefa foi criada sem prazo de entrega, então não tem cancelamento por atraso.";
  if (now.getTime() <= escrow.deliveryDeadline.getTime()) return `O prazo de entrega só vence em ${formatDeadline(escrow.deliveryDeadline)}. Depois disso você pode cancelar e receber de volta.`;
  return null;
}

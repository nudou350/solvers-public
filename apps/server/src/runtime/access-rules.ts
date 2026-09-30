// Regras puras de acesso pago (sem env/banco), testadas em test/trial.test.ts.

/** Acesso pago: licença vitalícia ou tarefa com garantia aberta (sem limites de teste). */
export type PaidAccess = { kind: "license"; licenseId: string } | { kind: "guarantee"; escrowId: string };

/** Status de escrow em que a tarefa ainda está em andamento (pending = transação não confirmada). */
export const OPEN_ESCROW_STATUSES = ["active", "disputed"] as const;

/** A garantia dá acesso enquanto está aberta: confirmada, não encerrada, não aprovada nem reembolsada. */
export function escrowGivesAccess(e: { status: string; closed: boolean }): boolean {
  return !e.closed && (OPEN_ESCROW_STATUSES as readonly string[]).includes(e.status);
}

/** Linha de acesso do activate_solver para acesso pago. */
export function paidAccessLine(kind: PaidAccess["kind"]): string {
  return kind === "license" ? "Acesso: licença vitalícia." : "Acesso: tarefa com garantia (sem limites enquanto a garantia estiver aberta).";
}

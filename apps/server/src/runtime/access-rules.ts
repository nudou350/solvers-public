// Regras puras de acesso pago (sem env/banco), testadas em test/trial.test.ts.

/** Acesso pago: licença vitalícia ou tarefa com garantia aberta (sem limites de teste). */
export type PaidAccess = { kind: "license"; licenseId: string } | { kind: "guarantee"; escrowId: string };

/** Acesso gratuito a um Solver da plataforma (PLATFORM_AGENTS): sem licença, sem teste grátis e sem contador de usos. */
export type PlatformAccess = { kind: "platform" };

/** Status de escrow em que a tarefa ainda está em andamento (pending = transação não confirmada). */
export const OPEN_ESCROW_STATUSES = ["active", "disputed"] as const;

/** A garantia dá acesso enquanto está aberta: confirmada, não encerrada, não aprovada nem reembolsada. */
export function escrowGivesAccess(e: { status: string; closed: boolean }): boolean {
  return !e.closed && (OPEN_ESCROW_STATUSES as readonly string[]).includes(e.status);
}

/** Resultado da checagem de licença: tem, não tem, ou não deu para confirmar (RPC lento ou fora do ar). */
export type LicenseCheck = { state: "owned"; id: string } | { state: "none" } | { state: "unknown" };

/**
 * Sem acesso pago confirmado: o que bloqueia antes do teste grátis? null = segue para o teste.
 * - "unverified": não deu para confirmar a licença (RPC): nunca manda comprar nem gasta teste por causa disso.
 * - "retired": solver aposentado não tem teste.
 * - "agent_no_trial": agente (login SIWS direto) não tem teste grátis.
 */
export function blockBeforeTrial(i: { licenseUnknown: boolean; allowTrial: boolean; agent: boolean }): "unverified" | "retired" | "agent_no_trial" | null {
  if (i.licenseUnknown) return "unverified";
  if (!i.allowTrial) return "retired";
  if (i.agent) return "agent_no_trial";
  return null;
}

/** Linha de acesso do activate_solver para acesso pago (ou gratuito de Solver da plataforma). */
export function paidAccessLine(kind: PaidAccess["kind"] | PlatformAccess["kind"]): string {
  if (kind === "platform") return "Acesso: gratuito (Solver da plataforma, sem licença e sem limites de teste).";
  return kind === "license" ? "Acesso: licença vitalícia." : "Acesso: tarefa com garantia (sem limites enquanto a garantia estiver aberta).";
}

import type { SimulationResult } from "@solvers/chain";
import { HttpError } from "../lib/http.js";

/**
 * Decide o que fazer com a simulação de uma transação ANTES de pedir a assinatura (função pura, sem RPC).
 * - ok: segue.
 * - rejected (regra do programa ou saldo): a operação falharia de verdade; responde 409 com a mensagem amigável.
 *   Não usa 422: o front trata 422 como "a rede não confirmou, nada foi cobrado", o que esconderia o motivo.
 * - failed / infra (RPC fora, timeout, blockhash, conta ausente): NÃO bloqueia (fail-open). A simulação é uma
 *   conveniência; o preflight do envio continua sendo a barreira final. Só registra no log.
 */
export function assertSimulationOk(result: SimulationResult, label: string, log: (msg: string) => void = console.warn): void {
  if (result.ok) return;
  if (result.kind === "rejected") {
    throw new HttpError(409, result.message, "operation_rejected", {
      programError: result.name ?? undefined,
      programErrorCode: result.code ?? undefined,
    });
  }
  log(`[simulate] ${label}: simulação ${result.kind === "infra" ? "indisponível" : "falhou por motivo não classificado"}, seguindo sem bloquear: ${result.message}`);
}

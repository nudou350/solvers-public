import type { SimulationResult } from "@solvers/chain";
import { SUPPLY_ERROR_CODES, SUPPLY_ERROR_HTTP_STATUS } from "@solvers/shared";
import { SOLVERS_ERROR__SOLD_OUT } from "@solvers/client";
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
    // Teto de licenças atingido entre o espelho e a cadeia: mesmo código do pré-check, para a tela mostrar "Esgotado".
    if (result.code === SOLVERS_ERROR__SOLD_OUT) {
      throw new HttpError(SUPPLY_ERROR_HTTP_STATUS[SUPPLY_ERROR_CODES.soldOut], result.message, SUPPLY_ERROR_CODES.soldOut);
    }
    throw new HttpError(409, result.message, "operation_rejected", {
      programError: result.name ?? undefined,
      programErrorCode: result.code ?? undefined,
    });
  }
  log(`[simulate] ${label}: simulação ${result.kind === "infra" ? "indisponível" : "falhou por motivo não classificado"}, seguindo sem bloquear: ${result.message}`);
}

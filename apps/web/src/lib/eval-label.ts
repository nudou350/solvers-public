// Rótulos honestos da nota de desempenho (PACKAGE_SPEC.md §12.2/§20, fase P5).
// Hoje toda nota existente vem de um teste interno da equipe (checagens automáticas): "verificado"
// só valeria para evalMethod "verified", que ainda não existe. Sem nota (0/ausente) = sem avaliações.

/** Há nota de desempenho? (0, nulo ou inválido = ainda não avaliado.) */
export function hasEvalScore(score: number | null | undefined): score is number {
  return typeof score === "number" && Number.isFinite(score) && score > 0;
}

/** "82% nos testes internos" ou "Sem avaliações ainda". */
export function evalShort(score: number | null | undefined): string {
  return hasEvalScore(score) ? `${Math.round(score)}% nos testes internos` : "Sem avaliações ainda";
}

/** Frase longa para detalhes e dicas. */
export const EVAL_METHOD_NOTE = "Teste interno da equipe (checagens automáticas), não uma verificação independente.";

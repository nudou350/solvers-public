// Rótulos honestos da nota de desempenho (PACKAGE_SPEC.md §12.2/§20, fase P5).
// Hoje toda nota existente vem de um teste interno da equipe (checagens automáticas): "verificado"
// só valeria para evalMethod "verified", que ainda não existe. Sem nota (0/ausente) = sem avaliações.
// Textos em messages/<locale>/errors.json (eval.*). Sem `locale`, vale o idioma da página no navegador;
// componente de servidor deve passar o `locale` da página.
import type { Locale } from "@/i18n/routing";
import { localText } from "./local-text";

/** Há nota de desempenho? (0, nulo ou inválido = ainda não avaliado.) */
export function hasEvalScore(score: number | null | undefined): score is number {
  return typeof score === "number" && Number.isFinite(score) && score > 0;
}

/** "82% in internal tests" / "82% nos testes internos", ou "No reviews yet" / "Sem avaliações ainda". */
export function evalShort(score: number | null | undefined, locale?: Locale): string {
  return hasEvalScore(score) ? localText("eval.short", { score: Math.round(score) }, locale) : localText("eval.none", undefined, locale);
}

/** Frase longa para detalhes e dicas, no idioma da página. */
export function evalMethodNote(locale?: Locale): string {
  return localText("eval.note", undefined, locale);
}

// Rótulos da nota de desempenho no idioma da página (os de lib/eval-label.ts são só em português).
// Regra do projeto: a nota é "teste interno da equipe", nunca "verificada".
import { useTranslations } from "next-intl";
import { hasEvalScore } from "@/lib/eval-label";

type Tr = (key: string, values?: Record<string, string | number>) => string;

/** Texto curto ("82% on internal tests" / "No ratings yet") a partir de um tradutor do namespace catalog. */
export function evalShortWith(t: Tr, score: number | null | undefined): string {
  return hasEvalScore(score) ? t("eval.short", { score: Math.round(score) }) : t("eval.none");
}

export function useEvalText(): { short: (score: number | null | undefined) => string; note: string } {
  const t = useTranslations("catalog") as unknown as Tr;
  return { short: (score) => evalShortWith(t, score), note: t("eval.note") };
}

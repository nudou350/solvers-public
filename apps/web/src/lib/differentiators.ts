import type { IconName } from "@/components/ui/Icon";
import type { Locale } from "@/i18n/routing";
import { localText } from "./local-text";

// Diferenciais comprovados de um especialista (PACKAGE_SPEC.md 4.2 e 20), em linguagem simples.
// Valores desconhecidos (um diferencial novo no servidor) são ignorados em vez de aparecer cru.
// Textos em messages/<locale>/errors.json (differentiators.<chave>.label|text); aqui ficam só os ícones.
// `label` e `text` do mapa seguem o idioma da página no navegador; em componente de servidor use as funções
// com `locale`.
const ICONS: Record<string, IconName> = {
  memory: "history",
  escalation: "message",
  liveData: "refresh",
  tool: "wrench",
  verifier: "shield-check",
};

export const DIFFERENTIATORS: Record<string, { readonly label: string; readonly text: string; icon: IconName }> = Object.fromEntries(
  Object.entries(ICONS).map(([k, icon]) => [
    k,
    {
      icon,
      get label() {
        return localText(`differentiators.${k}.label`);
      },
      get text() {
        return localText(`differentiators.${k}.text`);
      },
    },
  ]),
);

export function differentiatorLabel(key: string, locale?: Locale): string {
  return key in ICONS ? localText(`differentiators.${key}.label`, undefined, locale) : key;
}

/** Frase curta do diferencial no idioma pedido (vazio se a vitrine não conhece a chave). */
export function differentiatorText(key: string, locale?: Locale): string {
  return key in ICONS ? localText(`differentiators.${key}.text`, undefined, locale) : "";
}

/** Só os diferenciais que a vitrine sabe nomear, na ordem em que vieram. */
export function knownDifferentiators(keys: readonly string[]): string[] {
  return keys.filter((k) => k in ICONS);
}

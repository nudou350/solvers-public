// Texto traduzido fora de componentes React (erros lançados, rótulos puros): usa messages/<locale>/errors.json.
// Sem `locale` explícito, vale o idioma da página aberta no navegador (<html lang>, que o layout define);
// no servidor (sem navegador) cai em inglês. Quem renderiza no servidor deve passar o `locale` da página.
import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/routing";
import en from "../../messages/en/errors.json";
import pt from "../../messages/pt/errors.json";

const MESSAGES: Record<Locale, unknown> = { en, pt };

type Values = Record<string, string | number>;
export type ErrorsTranslator = ((key: string, values?: Values) => string) & { has: (key: string) => boolean };

const cache = new Map<Locale, ErrorsTranslator>();

/** Idioma da página no navegador (<html lang="pt-BR"> ou prefixo /pt); no servidor, inglês. */
export function detectLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const lang = document.documentElement.lang?.toLowerCase() ?? "";
  if (lang.startsWith("pt")) return "pt";
  if (lang.startsWith("en")) return "en";
  return /^\/pt(\/|$)/.test(window.location.pathname) ? "pt" : "en";
}

/** Tradutor do namespace "errors" fora do React. */
export function errorsTranslator(locale: Locale = detectLocale()): ErrorsTranslator {
  let t = cache.get(locale);
  if (!t) {
    const tr = createTranslator({ locale, messages: { errors: MESSAGES[locale] } as never, namespace: "errors" } as never) as unknown as ErrorsTranslator;
    t = Object.assign((key: string, values?: Values) => tr(key, values), { has: (key: string) => tr.has(key) });
    cache.set(locale, t);
  }
  return t;
}

/** Texto de errors.<key> no idioma da página (ou no `locale` dado). */
export function localText(key: string, values?: Values, locale?: Locale): string {
  return errorsTranslator(locale)(key, values);
}

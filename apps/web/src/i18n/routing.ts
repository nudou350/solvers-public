import { defineRouting } from "next-intl/routing";

// Inglês é o padrão e fica sem prefixo (/solvers); português usa /pt (/pt/solvers).
// A 1ª visita escolhe pelo Accept-Language; depois vale o cookie NEXT_LOCALE (trocado pelo seletor do header).
export const routing = defineRouting({
  locales: ["en", "pt"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];

/** Locale BCP 47 para Intl (números, datas). */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", pt: "pt-BR" };

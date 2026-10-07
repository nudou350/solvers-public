"use client";
// Texto de erro no idioma da página. A API devolve { error, code } (ApiError.code): se messages/<locale>/errors.json
// tiver errors.api.<code>, usa a tradução; senão cai na mensagem que veio (erros lançados pelo cliente já vêm
// no idioma da página, via lib/local-text).
import { ApiError } from "@solvers/api-client";
import { useTranslations } from "next-intl";

export function useErrorText(): (e: unknown) => string {
  const t = useTranslations("errors");
  return (e: unknown) => {
    if (e instanceof ApiError && e.code && t.has(`api.${e.code}`)) return t(`api.${e.code}`);
    if (e instanceof Error && e.message) return e.message;
    return t("generic");
  };
}

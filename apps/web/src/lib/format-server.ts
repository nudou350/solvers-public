import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { type Format, makeFormat, type T } from "./format";

/** Formatadores no idioma da página (componente de servidor async). */
export async function getFormat(): Promise<Format> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("format");
  return makeFormat(locale, t as unknown as T);
}

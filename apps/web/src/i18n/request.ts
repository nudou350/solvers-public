import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { NAMESPACES } from "./namespaces";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => [ns, (await import(`../../messages/${locale}/${ns}.json`)).default] as const),
  );
  return { locale, messages: Object.fromEntries(entries) };
});

import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { cache } from "react";
import { ResaleSoon } from "@/components/creator/ResaleSoon";
import { ResaleMarket } from "@/components/resale/ResaleMarket";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { serverApi } from "@/lib/api";

// O mercado muda a cada anúncio e venda: sempre renderizado na hora. A flag resaleEnabled vem do servidor.
export const dynamic = "force-dynamic";

const loadConfig = cache(() => serverApi().getConfig());

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadConfig().catch(() => null);
  const t = await getTranslations("resale.meta");
  if (config?.resaleEnabled) return { title: t("title"), description: t("description") };
  return { title: t("soonTitle"), description: t("soonDescription") };
}

function LoadFailed() {
  const t = useTranslations("resale.loadFailed");
  return (
    <section className="wrap sec">
      <Empty icon="warning" title={t("title")} action={<Button href="/resale">{t("retry")}</Button>}>
        {t("body")}
      </Empty>
    </section>
  );
}

export default async function ResalePage() {
  const config = await loadConfig().catch(() => null);
  if (!config) return <LoadFailed />;
  // Revenda desligada: segue o "Em breve" de sempre, sem chamar a lista de anúncios.
  if (!config.resaleEnabled) return <ResaleSoon />;
  const lang = (await getLocale()) as Locale;
  const listings = await serverApi().getResaleListings({ lang }).catch(() => null);
  if (!listings) return <LoadFailed />;
  return <ResaleMarket listings={listings} rate={config.brlPerUsd} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PrivateWithdrawView } from "@/components/creator/PrivateWithdraw";
import { CLOAK_ENABLED } from "@/lib/cloak/config";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "creator.meta" });
  return { title: t("privateWithdraw"), robots: { index: false } };
}

// Recurso opt-in (NEXT_PUBLIC_CLOAK_ENABLED=1): roda na rede real, separada da rede do resto da vitrine.
export default function PrivateWithdrawPage() {
  if (!CLOAK_ENABLED) notFound();
  return <PrivateWithdrawView />;
}

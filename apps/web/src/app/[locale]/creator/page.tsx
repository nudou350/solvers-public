import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CreatorDashboardView } from "@/components/creator/Dashboard";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "creator.meta" });
  return { title: t("dashboard") };
}

export default function CreatorPage() {
  return <CreatorDashboardView />;
}

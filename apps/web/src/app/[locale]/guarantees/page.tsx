import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Guarantees } from "@/components/account/Guarantees";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.meta");
  return { title: t("guarantees"), robots: { index: false } };
}

export default function GuaranteesPage() {
  return <Guarantees />;
}

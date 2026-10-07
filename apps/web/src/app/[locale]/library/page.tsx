import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Licenses } from "@/components/account/Licenses";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.meta");
  return { title: t("library"), robots: { index: false } };
}

export default function LibraryPage() {
  return <Licenses />;
}

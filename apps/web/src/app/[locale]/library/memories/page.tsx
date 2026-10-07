import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Memories } from "@/components/account/Memories";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.meta");
  return { title: t("memories"), robots: { index: false } };
}

export default function LibraryMemoriesPage() {
  return <Memories />;
}

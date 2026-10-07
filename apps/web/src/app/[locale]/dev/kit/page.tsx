import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Kit } from "./Kit";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("devkit");
  return { title: t("meta.title"), robots: { index: false } };
}

// Página de desenvolvimento: fora da produção, a não ser com NEXT_PUBLIC_SHOW_DEV_KIT=1.
export default function DevKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SHOW_DEV_KIT !== "1") notFound();
  return <Kit />;
}

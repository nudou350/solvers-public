import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubmissionsView } from "@/components/creator/Submissions";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "submissions.meta" });
  return { title: t("listTitle"), robots: { index: false } };
}

export default async function SubmissionsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SubmissionsView />;
}

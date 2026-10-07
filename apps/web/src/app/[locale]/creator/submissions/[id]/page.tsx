import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubmissionDetailView } from "@/components/creator/SubmissionDetail";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "submissions.meta" });
  return { title: t("detailTitle"), robots: { index: false } };
}

export default async function SubmissionPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <SubmissionDetailView id={id} />;
}

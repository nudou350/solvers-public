import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReviewDetailView } from "@/components/admin/ReviewDetail";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.meta" });
  return { title: t("reviewTitle"), robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewDetailView id={id} />;
}

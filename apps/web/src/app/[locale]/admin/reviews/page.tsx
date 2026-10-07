import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReviewQueueView } from "@/components/admin/ReviewQueue";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.meta" });
  return { title: t("queueTitle"), robots: { index: false, follow: false } };
}

export default function ReviewsPage() {
  return <ReviewQueueView />;
}

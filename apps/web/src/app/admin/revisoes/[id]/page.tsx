import type { Metadata } from "next";
import { ReviewDetailView } from "@/components/admin/ReviewDetail";

export const metadata: Metadata = { title: "Revisar envio", robots: { index: false, follow: false } };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewDetailView id={id} />;
}

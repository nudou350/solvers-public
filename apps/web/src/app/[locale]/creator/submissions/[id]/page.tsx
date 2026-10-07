import type { Metadata } from "next";
import { SubmissionDetailView } from "@/components/creator/SubmissionDetail";

export const metadata: Metadata = { title: "Acompanhar envio", robots: { index: false } };

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubmissionDetailView id={id} />;
}

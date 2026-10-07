import type { Metadata } from "next";
import { ReviewQueueView } from "@/components/admin/ReviewQueue";

export const metadata: Metadata = { title: "Revisões", robots: { index: false, follow: false } };

export default function ReviewsPage() {
  return <ReviewQueueView />;
}

import type { Metadata } from "next";
import { SubmissionsView } from "@/components/creator/Submissions";

export const metadata: Metadata = { title: "Meus envios", robots: { index: false } };

export default function SubmissionsPage() {
  return <SubmissionsView />;
}

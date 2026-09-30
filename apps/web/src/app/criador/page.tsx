import type { Metadata } from "next";
import { CreatorDashboardView } from "@/components/creator/Dashboard";

export const metadata: Metadata = { title: "Painel do criador" };

export default function CreatorPage() {
  return <CreatorDashboardView />;
}

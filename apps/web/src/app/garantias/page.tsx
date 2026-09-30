import type { Metadata } from "next";
import { Guarantees } from "@/components/account/Guarantees";

export const metadata: Metadata = { title: "Garantias em andamento", robots: { index: false } };

export default function GarantiasPage() {
  return <Guarantees />;
}

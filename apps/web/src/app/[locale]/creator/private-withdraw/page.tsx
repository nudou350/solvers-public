import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrivateWithdrawView } from "@/components/creator/PrivateWithdraw";
import { CLOAK_ENABLED } from "@/lib/cloak/config";

export const metadata: Metadata = { title: "Saque privado", robots: { index: false } };

// Recurso opt-in (NEXT_PUBLIC_CLOAK_ENABLED=1): roda na rede real, separada da rede do resto da vitrine.
export default function PrivateWithdrawPage() {
  if (!CLOAK_ENABLED) notFound();
  return <PrivateWithdrawView />;
}

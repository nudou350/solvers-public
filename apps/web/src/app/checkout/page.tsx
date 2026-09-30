import type { Metadata } from "next";
import { AgentMissing } from "@/components/checkout/AgentMissing";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { loadAgent } from "@/components/checkout/loadAgent";
import { param, parseType } from "@/components/checkout/util";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const sp = await searchParams;
  const { detail, error } = await loadAgent(param(sp.agent));
  if (!detail) return <AgentMissing error={error} />;
  let type = parseType(sp.type);
  // Tipo indisponível para este especialista: cai na licença permanente.
  if (type === "credits" && !detail.agent.pricePerUseUsdc) type = "permanent";
  if (type === "guarantee" && !detail.guarantee) type = "permanent";
  return <CheckoutView key={detail.agent.id} detail={detail} type={type} />;
}

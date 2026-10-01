import type { Metadata } from "next";
import { AgentMissing } from "@/components/checkout/AgentMissing";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { ListingMissing } from "@/components/checkout/ListingMissing";
import { loadAgent } from "@/components/checkout/loadAgent";
import { param, parseType } from "@/components/checkout/util";
import { serverApi } from "@/lib/api";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false } };

// O anúncio muda a cada venda: a licença usada é sempre lida na hora.
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const sp = await searchParams;
  const listingId = param(sp.listing);
  if (listingId) return <UsedLicenseCheckout listingId={listingId} />;
  const { detail, error } = await loadAgent(param(sp.agent));
  if (!detail) return <AgentMissing error={error} />;
  let type = parseType(sp.type);
  // Especialista sem garantia (ou tipo desconhecido, como o antigo "credits"): cai na licença permanente.
  if (type === "guarantee" && !detail.guarantee) type = "permanent";
  return <CheckoutView key={detail.agent.id} detail={detail} type={type} />;
}

/** /checkout?listing=<licença>: compra de uma licença usada do mercado de revenda (só USDC). */
async function UsedLicenseCheckout({ listingId }: { listingId: string }) {
  const api = serverApi();
  // Busca direta pelo id da licença: a lista geral é cortada em 200 anúncios.
  const data = await Promise.all([api.getConfig(), api.getResaleListing(listingId)]).catch(() => null);
  if (!data) return <ListingMissing reason="unavailable" />;
  const [config, listing] = data;
  if (!config.resaleEnabled) return <ListingMissing reason="disabled" />;
  if (!listing) return <ListingMissing reason="gone" />;
  const { detail, error } = await loadAgent(listing.agent.slug);
  if (!detail) return <AgentMissing error={error} />;
  return <CheckoutView key={`${detail.agent.id}:${listing.id}`} detail={detail} type="permanent" listing={listing} />;
}

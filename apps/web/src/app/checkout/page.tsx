import type { Metadata } from "next";
import { AgentMissing } from "@/components/checkout/AgentMissing";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
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
  // Especialista da plataforma é gratuito e não tem licença: não há o que comprar.
  if (detail.agent.platform) return <PlatformFree slug={detail.agent.slug} name={detail.agent.name} />;
  let type = parseType(sp.type);
  // Especialista sem garantia (ou tipo desconhecido, como o antigo "credits"): cai na licença permanente.
  if (type === "guarantee" && !detail.guarantee) type = "permanent";
  return <CheckoutView key={detail.agent.id} detail={detail} type={type} />;
}

function PlatformFree({ slug, name }: { slug: string; name: string }) {
  return (
    <section className="wrap" style={{ paddingTop: 56, paddingBottom: 72 }}>
      <Empty icon="gift" title={`${name} é gratuito`} action={<Button href={`/instalar?agent=${encodeURIComponent(slug)}`} iconRight="arrow-right">Instalar na minha IA</Button>}>
        Este especialista já está incluído na plataforma: não tem preço nem licença. É só conectar o Solvers à sua IA e usar.
      </Empty>
    </section>
  );
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

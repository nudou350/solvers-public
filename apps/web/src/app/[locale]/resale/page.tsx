import type { Metadata } from "next";
import { cache } from "react";
import { ResaleSoon } from "@/components/creator/ResaleSoon";
import { ResaleMarket } from "@/components/resale/ResaleMarket";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { serverApi } from "@/lib/api";

// O mercado muda a cada anúncio e venda: sempre renderizado na hora. A flag resaleEnabled vem do servidor.
export const dynamic = "force-dynamic";

const loadConfig = cache(() => serverApi().getConfig());

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadConfig().catch(() => null);
  if (config?.resaleEnabled)
    return {
      title: "Mercado de revenda",
      description: "Licenças permanentes de especialistas à venda por outras pessoas. Mesma nota de desempenho do original, e o criador ganha royalty em cada revenda.",
    };
  return {
    title: "Mercado de revenda (em breve)",
    description: "Em breve: revenda a licença do especialista que você não usa mais. O criador ganha royalty em cada revenda feita no Solvers.",
  };
}

function LoadFailed() {
  return (
    <section className="wrap sec">
      <Empty icon="warning" title="Não deu para carregar o mercado de revenda" action={<Button href="/resale">Tentar de novo</Button>}>
        O servidor não respondeu agora. Tente de novo em instantes.
      </Empty>
    </section>
  );
}

export default async function ResalePage() {
  const config = await loadConfig().catch(() => null);
  if (!config) return <LoadFailed />;
  // Revenda desligada: segue o "Em breve" de sempre, sem chamar a lista de anúncios.
  if (!config.resaleEnabled) return <ResaleSoon />;
  const listings = await serverApi().getResaleListings().catch(() => null);
  if (!listings) return <LoadFailed />;
  return <ResaleMarket listings={listings} rate={config.brlPerUsd} />;
}

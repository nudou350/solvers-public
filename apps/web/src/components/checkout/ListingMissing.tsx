import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

/** Anúncio de licença usada ausente (vendido, cancelado), revenda desligada ou API fora do ar. */
export function ListingMissing({ reason }: { reason: "gone" | "disabled" | "unavailable" }) {
  return (
    <section className="wrap" style={{ paddingTop: 56, paddingBottom: 72 }}>
      {reason === "unavailable" ? (
        <Empty icon="warning" title="Não deu para carregar o anúncio" action={<Button href="/revenda">Ver o mercado de revenda</Button>}>
          O servidor não respondeu agora. Tente de novo em instantes.
        </Empty>
      ) : reason === "disabled" ? (
        <Empty icon="tag" title="A revenda não está aberta agora" action={<Button href="/">Explorar especialistas</Button>}>
          O mercado de revenda está fechado por enquanto. Você ainda pode comprar a licença de um especialista novo.
        </Empty>
      ) : (
        <Empty icon="tag" title="Esse anúncio não está mais disponível" action={<Button href="/revenda">Ver outros anúncios</Button>}>
          Ele foi vendido, cancelado ou mudou. Nada foi cobrado.
        </Empty>
      )}
    </section>
  );
}

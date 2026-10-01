"use client";
// Mercado de revenda (/revenda com a revenda ligada): licenças permanentes à venda por outras pessoas.
// Os anúncios vêm do servidor (on-chain, via indexer). Nada aqui é de exemplo: sem anúncio, o estado vazio diz isso.
import type { ResaleListing } from "@solvers/api-client";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { categoryLabel, int } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { ResaleRow } from "./ResaleRow";

type Sort = "price" | "rating" | "trend";

const SORTS: { id: Sort; label: string }[] = [
  { id: "price", label: "Menor preço" },
  { id: "rating", label: "Melhor nota" },
  { id: "trend", label: "Em alta" },
];

const byPrice = (x: ResaleListing, y: ResaleListing) => x.priceUsdc - y.priceUsdc || x.listedAt.localeCompare(y.listedAt);
const COMPARE: Record<Sort, (x: ResaleListing, y: ResaleListing) => number> = {
  price: byPrice,
  rating: (x, y) => y.agent.userRating - x.agent.userRating || y.agent.evalScore - x.agent.evalScore || byPrice(x, y),
  trend: (x, y) => y.agent.trend7d - x.agent.trend7d || byPrice(x, y),
};

export function ResaleMarket({ listings, rate }: { listings: ResaleListing[]; rate: number }) {
  const { me } = useSession();
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("price");
  const sortLabelId = useId();
  const sortRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // radiogroup: Tab entra só na opção marcada; as setas movem a seleção (e o foco).
  function onSortKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + SORTS.length) % SORTS.length;
    const o = SORTS[next];
    if (!o) return;
    setSort(o.id);
    sortRefs.current[next]?.focus();
  }

  // Só as categorias que têm anúncio, na ordem em que aparecem.
  const categories = useMemo(() => [...new Set(listings.map((l) => l.agent.category))], [listings]);
  const shown = useMemo(() => listings.filter((l) => !cat || l.agent.category === cat).sort(COMPARE[sort]), [listings, cat, sort]);

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <div className="col" style={gap(12, { maxWidth: 720, marginBottom: 32 })}>
        <h1 className="display h1s">Mercado de revenda</h1>
        <p className="lead">
          Licenças permanentes à venda por outras pessoas. Cada uma tem a mesma nota de desempenho do especialista original, e o criador recebe uma parte de cada revenda.
        </p>
      </div>

      <div className="g3 m1" style={gap(16, { marginBottom: 32 })}>
        <div className="card-flat pad-s row start" style={gap(12)}>
          <span className="ok">
            <Icon name="shield-check" />
          </span>
          <span className="small">
            <b>Licença verificada.</b> A propriedade é conferida antes de cada venda.
          </span>
        </div>
        <div className="card-flat pad-s row start" style={gap(12)}>
          <span className="brand">
            <Icon name="repeat" />
          </span>
          <span className="small">
            <b>Troca imediata.</b> Você paga e a licença passa para você na hora. As memórias do antigo dono não vão junto.
          </span>
        </div>
        <div className="card-flat pad-s row start" style={gap(12)}>
          <span className="warn">
            <Icon name="users" />
          </span>
          <span className="small">
            <b>Vendedores com reputação.</b> Quando o vendedor já tem histórico, mostramos o selo dele.
          </span>
        </div>
      </div>

      {listings.length === 0 ? (
        <Empty
          icon="tag"
          title="Nenhuma licença à venda agora"
          action={
            <>
              <Button href="/biblioteca" variant="secondary" icon="library">
                Ver minha biblioteca
              </Button>
              <Button href="/">Explorar especialistas</Button>
            </>
          }
        >
          Quando alguém anunciar uma licença, ela aparece aqui. Você também pode anunciar a sua, na sua biblioteca.
        </Empty>
      ) : (
        <>
          <div className="row between wrapx m-col" style={gap(16, { marginBottom: 22 })}>
            <div className="row wrapx" style={gap(8)} role="group" aria-label="Filtrar por categoria">
              <button type="button" className={`chip${cat === null ? " on" : ""}`} aria-pressed={cat === null} onClick={() => setCat(null)}>
                Todas
              </button>
              {categories.map((c) => (
                <button key={c} type="button" className={`chip${cat === c ? " on" : ""}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
            <div className="row m-col" style={gap(10)}>
              <span id={sortLabelId} className="small muted">
                Ordenar por
              </span>
              <div className="seg" role="radiogroup" aria-labelledby={sortLabelId}>
                {SORTS.map((o, i) => (
                  <button
                    key={o.id}
                    ref={(el) => {
                      sortRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={sort === o.id}
                    tabIndex={sort === o.id ? 0 : -1}
                    className={sort === o.id ? "on" : undefined}
                    onClick={() => setSort(o.id)}
                    onKeyDown={(e) => onSortKey(e, i)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {shown.length === 1 ? "1 licença à venda" : `${int(shown.length)} licenças à venda`}
          </p>
          <div className="col" style={gap(14)}>
            {shown.map((l) => (
              <ResaleRow key={l.id} listing={l} rate={rate} mine={!!me && l.sellerWallet === me.wallet} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

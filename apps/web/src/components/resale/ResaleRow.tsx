// Uma licença à venda no mercado de revenda (design/screens/mercado-de-revenda.html): cinco colunas no computador, empilhadas no celular.
import type { ResaleListing } from "@solvers/api-client";
import Link from "next/link";
import { agentHref } from "@/components/catalog/data";
import { Button } from "@/components/ui/Button";
import { Chip, RepBadge } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { Tile } from "@/components/ui/Tile";
import { brl, pct, repLevel, short, trendCls, usdc } from "@/lib/format";
import { gap } from "@/lib/style";

/** Diferença para o preço de um especialista novo, em porcentagem inteira. null: sem preço de comparação. */
export function diffVsNew(listingUsdc: number, newUsdc: number): number | null {
  return newUsdc > 0 ? Math.round(((listingUsdc - newUsdc) / newUsdc) * 100) : null;
}

export function ResaleRow({ listing, rate, mine }: { listing: ResaleListing; rate: number; mine: boolean }) {
  const { agent: a } = listing;
  const diff = diffVsNew(listing.priceUsdc, a.priceUsdc);
  const trend = a.trend7d;
  const hasTrend = Number.isFinite(trend) && trend !== 0;
  const cls = trendCls(trend);
  return (
    <article className="card resale-row" aria-label={`${a.name}, à venda por ${brl(listing.priceUsdc, rate)}`}>
      <div className="row" style={gap(14, { minWidth: 0 })}>
        <Tile category={a.category} />
        <div className="grow">
          <Link className="h4 trunc" href={agentHref(a.slug)} style={{ display: "block" }}>
            {a.name}
          </Link>
          <div className="small muted trunc">{mine ? "Vendido por você" : `Vendido por ${short(listing.sellerWallet)}`}</div>
          {listing.sellerReputation != null ? (
            <RepBadge score={listing.sellerReputation} style={{ marginTop: 6 }}>
              <span>Vendedor {repLevel(listing.sellerReputation).label.toLowerCase()}</span>
            </RepBadge>
          ) : null}
        </div>
      </div>

      <div className="col" style={gap(6)}>
        {a.reviewsCount > 0 ? <Stars rating={a.userRating} showValue count={a.reviewsCount} /> : <span className="tiny faint">Ainda sem avaliações</span>}
        {a.evalScore > 0 ? (
          <span className="verified" title="Casos de teste resolvidos">
            <Icon name="shield-check" size="s" />
            {a.evalScore}% nos testes
          </span>
        ) : null}
      </div>

      <div className="row" style={gap(12)}>
        {hasTrend ? (
          <div className="col" style={gap(0)}>
            <span className={`trend ${cls}`}>
              <Icon name={cls === "up" ? "trend-up" : cls === "down" ? "trend-down" : "minus"} size="s" />
              {pct(trend)}
            </span>
            <span className="tiny faint">procura em 7 dias</span>
          </div>
        ) : (
          <span className="tiny faint">Sem variação de procura recente</span>
        )}
      </div>

      <div className="col" style={gap(2)}>
        <b className="num" style={{ fontSize: 24 }}>
          {brl(listing.priceUsdc, rate)}
        </b>
        <span className="tiny faint">{usdc(listing.priceUsdc)}</span>
        {diff != null ? (
          <span className={`tiny ${diff > 0 ? "warn" : "ok"}`}>
            {diff === 0 ? "Mesmo preço de um especialista novo" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}% em relação ao preço de novo`}
          </span>
        ) : null}
      </div>

      <div>
        {mine ? (
          <Chip tone="brand">Seu anúncio</Chip>
        ) : (
          <Button href={`/checkout?listing=${encodeURIComponent(listing.id)}`}>Comprar</Button>
        )}
      </div>
    </article>
  );
}

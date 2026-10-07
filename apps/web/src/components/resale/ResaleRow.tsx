// Uma licença à venda no mercado de revenda (design/screens/mercado-de-revenda.html): cinco colunas no computador, empilhadas no celular.
import type { ResaleListing } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { agentHref } from "@/components/catalog/data";
import { Button } from "@/components/ui/Button";
import { Chip, RepBadge } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { Tile } from "@/components/ui/Tile";
import { hasEvalScore } from "@/lib/eval-label";
import { short, trendCls, useFormat } from "@/lib/format";
import { gap } from "@/lib/style";

/** Diferença para o preço de um especialista novo, em porcentagem inteira. null: sem preço de comparação. */
export function diffVsNew(listingUsdc: number, newUsdc: number): number | null {
  return newUsdc > 0 ? Math.round(((listingUsdc - newUsdc) / newUsdc) * 100) : null;
}

export function ResaleRow({ listing, rate, mine }: { listing: ResaleListing; rate: number; mine: boolean }) {
  const { agent: a } = listing;
  const t = useTranslations("resale.row");
  const f = useFormat();
  const diff = diffVsNew(listing.priceUsdc, a.priceUsdc);
  const trend = a.trend7d;
  const hasTrend = Number.isFinite(trend) && trend !== 0;
  const cls = trendCls(trend);
  return (
    <article className="card resale-row" aria-label={t("aria", { name: a.name, price: f.brl(listing.priceUsdc, rate) })}>
      <div className="row" style={gap(14, { minWidth: 0 })}>
        <Tile category={a.category} />
        <div className="grow">
          <Link className="h4 trunc" href={agentHref(a.slug)} style={{ display: "block" }}>
            {a.name}
          </Link>
          <div className="small muted trunc">{mine ? t("soldByYou") : t("soldBy", { seller: short(listing.sellerWallet) })}</div>
          {listing.sellerReputation != null ? (
            <RepBadge score={listing.sellerReputation} style={{ marginTop: 6 }}>
              <span>{t("seller", { level: f.repLevel(listing.sellerReputation).label.toLowerCase() })}</span>
            </RepBadge>
          ) : null}
        </div>
      </div>

      <div className="col" style={gap(6)}>
        {a.reviewsCount > 0 ? <Stars rating={a.userRating} showValue count={a.reviewsCount} /> : <span className="tiny faint">{t("noReviews")}</span>}
        {hasEvalScore(a.evalScore) ? (
          <span className="verified" title={t("evalNote")}>
            <Icon name="shield-check" size="s" />
            {t("evalShort", { score: Math.round(a.evalScore) })}
          </span>
        ) : (
          <span className="tiny faint">{t("noEval")}</span>
        )}
      </div>

      <div className="row" style={gap(12)}>
        {hasTrend ? (
          <div className="col" style={gap(0)}>
            <span className={`trend ${cls}`}>
              <Icon name={cls === "up" ? "trend-up" : cls === "down" ? "trend-down" : "minus"} size="s" />
              {f.pct(trend)}
            </span>
            <span className="tiny faint">{t("demand")}</span>
          </div>
        ) : (
          <span className="tiny faint">{t("noTrend")}</span>
        )}
      </div>

      <div className="col" style={gap(2)}>
        <b className="num" style={{ fontSize: 24 }}>
          {f.brl(listing.priceUsdc, rate)}
        </b>
        <span className="tiny faint">{f.usdc(listing.priceUsdc)}</span>
        {diff != null ? (
          <span className={`tiny ${diff > 0 ? "warn" : "ok"}`}>
            {diff === 0 ? t("samePrice") : t(diff > 0 ? "diffUp" : "diffDown", { n: f.int(Math.abs(diff)) })}
          </span>
        ) : null}
      </div>

      <div>
        {mine ? (
          <Chip tone="brand">{t("yours")}</Chip>
        ) : (
          <Button href={`/checkout?listing=${encodeURIComponent(listing.id)}`}>{t("buy")}</Button>
        )}
      </div>
    </article>
  );
}

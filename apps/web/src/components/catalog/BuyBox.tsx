"use client";
import type { AgentSupply, TrialInfo } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useFormat } from "@/lib/format";
import { useMyAccess } from "@/lib/hooks";
import { gap } from "@/lib/style";

export type BuyBoxProps = {
  slug: string;
  name: string;
  priceUsdc: number;
  priceBrl: number | null;
  /** Teste grátis configurado pelo especialista; null = não tem teste. */
  trial: TrialInfo | null;
  hasGuarantee: boolean;
  rate: number;
  /** Revenda ligada (config.resaleEnabled): liberam "Licença usada" e, para quem já tem a licença, "Anunciar minha licença". */
  resaleOn?: boolean;
  /** Anúncio de revenda mais barato deste especialista (null/ausente: nada à venda). */
  resale?: { listingId: string; floorUsdc: number } | null;
  /** Teto de licenças (vendidas / máximo). Ausente ou `max: null` = ilimitado. */
  supply?: AgentSupply;
  /** Especialista da plataforma: gratuito, sem licença nem compra. Esconde preço e botão de compra. */
  platform?: boolean;
};

/** Caixa da página de um especialista da plataforma: sem preço nem compra, só como instalar. */
function PlatformBox({ slug }: { slug: string }) {
  const t = useTranslations("catalog.buy");
  const install = `/install?agent=${encodeURIComponent(slug)}`;
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="sol-line" style={{ borderRadius: 0, height: 4 }} />
      <div className="pad col" style={gap("18px")}>
        <div className="col" style={gap("4px")}>
          <span className="eyebrow">{t("platformTitle")}</span>
          <span className="display big num" style={{ fontSize: 56, whiteSpace: "nowrap" }}>
            {t("free")}
          </span>
          <span className="small faint">{t("noPurchase")}</span>
        </div>
        <Button href={install} size="lg" block iconRight="arrow-right">
          {t("install")}
        </Button>
        <ol className="col small" style={gap("10px")}>
          <Step n={1}>{t("step1")}</Step>
          <Step n={2}>{t("step2")}</Step>
          <Step n={3}>{t("step3")}</Step>
        </ol>
        <ul className="col small" style={gap("10px")}>
          <Check>{t("check1")}</Check>
          <Check>{t("check2")}</Check>
        </ul>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="row start" style={gap("10px")}>
      <span className="dot dot-now" aria-hidden style={{ width: 24, height: 24, fontSize: 12, borderWidth: 1.5 }}>
        {n}
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}

/** Caixa de compra da página do especialista: licença permanente, teste grátis (se houver) e acesso do usuário logado. */
export function BuyBox(p: BuyBoxProps) {
  if (p.platform) return <PlatformBox slug={p.slug} />;
  return <PaidBox {...p} />;
}

function PaidBox(p: BuyBoxProps) {
  const t = useTranslations("catalog.buy");
  const tTrial = useTranslations("catalog.trial");
  const f = useFormat();
  const access = useMyAccess(p.slug);
  // pt: reais (valor fixado pelo criador, se houver, senão pela cotação); en: dólar 1:1 com o USDC.
  const price = f.locale === "pt" ? (p.priceBrl != null ? f.brlValue(p.priceBrl) : f.brlValue(p.priceUsdc * p.rate)) : f.brl(p.priceUsdc, p.rate);
  const checkout = `/checkout?agent=${encodeURIComponent(p.slug)}&type=permanent`;
  const install = `/install?agent=${encodeURIComponent(p.slug)}`;
  const owned = !!access?.license;
  const usedHref = p.resale ? `/checkout?listing=${encodeURIComponent(p.resale.listingId)}` : null;
  const trialLeft = p.trial && access ? access.trialUsesLeft : null;
  const soldOut = !owned && p.supply?.left === 0;
  const limited = p.supply?.max != null && p.supply.left != null && p.supply.left > 0;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="sol-line" style={{ borderRadius: 0, height: 4 }} />
      <div className="pad col" style={gap("18px")}>
        {owned ? (
          <div className="note note-ok" role="status">
            <Icon name="check-circle" />
            <div className="note-body">
              <span className="note-title">{t("ownedTitle")}</span>
              <span className="small">{t("ownedBody")}</span>
              <div className="note-actions">
                <Button href={install} size="sm" iconRight="arrow-right">
                  {t("goInstall")}
                </Button>
                <Button href="/library" size="sm" variant="secondary">
                  {t("library")}
                </Button>
                {p.resaleOn ? (
                  <Button href="/library" size="sm" variant="ghost" icon="tag">
                    {t("listLicense")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {owned ? null : (
          <>
            <div className="col" style={gap("2px")}>
              <span className="eyebrow">{t("permanent")}</span>
              <div className="row price-row" style={gap("10px", { alignItems: "baseline" })}>
                <span className="display big num price-big" style={{ fontSize: 60, whiteSpace: "nowrap" }}>
                  {price}
                </span>
                <span className="muted">{t("oneTime")}</span>
              </div>
              <span className="small faint">{t("rate", { usdc: f.usdc(p.priceUsdc) })}</span>
            </div>
            {limited && p.supply ? (
              <span className="small" role="status">
                <Icon name="tag" size="s" /> {t.rich("supplyLeft", { left: p.supply.left ?? 0, max: p.supply.max ?? 0, b: (chunks) => <b>{chunks}</b> })}
              </span>
            ) : null}
            {soldOut ? (
              <div className="col" style={gap("8px")}>
                <Button size="lg" block disabled>
                  {t("soldOut")}
                </Button>
                <p className="small muted" role="status">
                  {p.resaleOn ? t("soldOutResale") : t("soldOutNoResale")}
                </p>
              </div>
            ) : (
              <Button href={checkout} size="lg" block iconRight="arrow-right">
                {t("buy")}
              </Button>
            )}
            {p.resaleOn && usedHref && p.resale ? (
              <Link className="row between card-flat pad-s" href={usedHref} style={gap("12px")}>
                <span className="col" style={gap("2px")}>
                  <span className="small faint">{t("cheaper")}</span>
                  <b>{t("usedFrom", { price: f.locale === "pt" ? f.brlValue(p.resale.floorUsdc * p.rate) : f.brl(p.resale.floorUsdc, p.rate) })}</b>
                  <span className="tiny faint">{t("usedNote")}</span>
                </span>
                <Icon name="arrow-right" />
              </Link>
            ) : null}
            {p.trial ? (
              <div className="col" style={gap("8px")}>
                <Button href={install} variant="secondary" block icon="play">
                  {t("tryFree")}
                </Button>
                <p className="small muted center" role="status">
                  {trialLeft == null
                    ? t("trialTry", { uses: tTrial("uses", { n: p.trial.uses }) })
                    : trialLeft > 0
                      ? t("trialLeft", { left: trialLeft, uses: tTrial("uses", { n: p.trial.uses }) })
                      : t("trialOver")}{" "}
                  <a className="link" href="#teste-gratis">
                    {t("seeTrial")}
                  </a>
                </p>
              </div>
            ) : null}
          </>
        )}
        <ul className="col small" style={gap("10px")}>
          <Check>{t("onChain")}</Check>
          {p.trial ? <Check>{t("trialInAi")}</Check> : null}
          <Check>{p.hasGuarantee ? t("withGuarantee") : t("noGuarantee")}</Check>
        </ul>
        {p.hasGuarantee ? (
          <>
            <div className="divider" />
            <a className="row between" href="#garantia" style={gap("12px")}>
              <span className="col" style={gap("2px")}>
                <span className="small faint">{t("guaranteeAsk")}</span>
                <b>{t("guaranteeTask")}</b>
              </span>
              <Icon name="arrow-right" />
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="row start" style={gap("10px")}>
      <span className="ok">
        <Icon name="check-circle" size="s" />
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}

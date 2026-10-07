import type { Agent } from "@solvers/api-client";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getLocale, getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CategoryExplorer } from "@/components/catalog/CategoryExplorer";
import { agentHref, creatorMap } from "@/components/catalog/data";
import { SearchHero } from "@/components/catalog/SearchHero";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { serverApi } from "@/lib/api";
import { hasEvalScore } from "@/lib/eval-label";
import { trendCls, useFormat, type Format } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { gap } from "@/lib/style";

// O catálogo muda a cada venda e avaliação: sempre renderizado na hora, com os dados da API.
export const dynamic = "force-dynamic";

async function loadHome(lang: Locale) {
  const api = serverApi();
  const [config, categories, creators, top, trending, fresh] = await Promise.all([
    api.getConfig(),
    api.getCategories(),
    api.getCreators(lang),
    api.getAgents({ sort: "rating", limit: 4, lang }),
    api.getAgents({ sort: "trend", limit: 5, lang }),
    api.getAgents({ sort: "new", limit: 3, lang }),
  ]);
  return { config, categories, creators: creatorMap(creators), top: top.slice(0, 4), trending: trending.slice(0, 5), fresh: fresh.slice(0, 3) };
}

type TFn = Awaited<ReturnType<typeof getTranslations>>;

/** "82% on internal tests" ou "No reviews yet" (nota de teste interno da equipe, nunca "verificada"). */
function evalText(t: TFn, f: Format, score: number | null | undefined): string {
  return hasEvalScore(score) ? t("eval.internal", { score: f.int(Math.round(score)) }) : t("eval.none");
}

export default async function Home() {
  const t = await getTranslations("home");
  const f = await getFormat();
  const locale = (await getLocale()) as Locale;
  const data = await loadHome(locale).catch(() => null);
  if (!data)
    return (
      <section className="wrap sec">
        <Empty icon="warning" title={t("loadFailed.title")} action={<Button href="/">{t("loadFailed.retry")}</Button>}>
          {t("loadFailed.body")}
        </Empty>
      </section>
    );
  const { config, categories, creators, top, trending, fresh } = data;
  const rate = config.brlPerUsd;
  // O cartão "Sua licença" mostra um pagamento: só serve a especialista pago (os da plataforma são gratuitos e sem licença).
  const hero = top.find((a) => !a.platform);

  return (
    <>
      <SearchHero creators={creators} rate={rate} aside={hero ? <HeroTicket agent={hero} rate={rate} /> : <div className="hide-m" />} />

      <CategoryExplorer categories={categories} initialTop={top} creators={creators} rate={rate} />

      <section className="wrap" style={{ paddingBottom: 72 }}>
        <div className="g2 gs2" style={gap("48px", { alignItems: "start" })}>
          <div>
            <div className="col" style={gap("8px", { marginBottom: 28 })}>
              <h2 className="display h2s">{t("trending.title")}</h2>
              <p className="muted" style={{ maxWidth: 560 }}>
                {t("trending.body")}
              </p>
            </div>
            {trending.length === 0 ? (
              <div className="card-flat pad center muted">{t("trending.empty")}</div>
            ) : (
              <div className="card pad-s" style={{ padding: "8px 24px" }}>
                {trending.map((a, i) => (
                  <TrendRow key={a.id} agent={a} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="col" style={gap("8px", { marginBottom: 28 })}>
              <h2 className="display h2s">{t("fresh.title")}</h2>
              <p className="muted" style={{ maxWidth: 560 }}>
                {t("fresh.body")}
              </p>
            </div>
            <div className="col" style={gap("14px")}>
              {fresh.map((a) => (
                <Link key={a.id} className="card pad-s" href={agentHref(a.slug)} style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <Tile category={a.category} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="trunc" style={{ display: "block" }}>
                      {a.name}
                    </b>
                    <div className="small muted trunc">
                      {t("fresh.published", { ago: f.ago(a.publishedAt) })} · {evalText(t, f, a.evalScore)}
                      {a.trialAvailable ? ` · ${t("freeTrial")}` : ""}
                    </div>
                  </div>
                  <span className="chip chip-brand flex-none">{t("fresh.badge")}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" id="como-funciona" style={{ paddingBottom: 72 }}>
        <div className="card-flat how" style={{ padding: "56px 48px" }}>
          <div className="col center" style={gap("12px", { alignItems: "center", marginBottom: 44 })}>
            <span className="eyebrow">{t("how.eyebrow")}</span>
            <h2 className="display h2">{t("how.title")}</h2>
          </div>
          <div className="g3" style={gap("40px")}>
            <Step n={1} title={t("how.step1Title")}>
              {t("how.step1Body")}
            </Step>
            <Step n={2} title={t("how.step2Title")}>
              {t("how.step2Body")}
            </Step>
            <Step n={3} title={t("how.step3Title")}>
              {t("how.step3Body")}
            </Step>
          </div>
          <div className="row wrapx" style={gap("14px", { justifyContent: "center", marginTop: 40 })}>
            <Button href="/install" size="lg" iconRight="arrow-right">
              {t("how.guide")}
            </Button>
            <Button href="/profile" size="lg" variant="secondary">
              {t("how.security")}
            </Button>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 16 }}>
        <div className="card pad-l row between wrapx m-col" style={gap("24px", { padding: "36px 44px" })}>
          <div className="col" style={gap("8px", { maxWidth: 640 })}>
            <h2 className="display h2s">{t("cta.title")}</h2>
            <p className="muted">{t("cta.body")}</p>
          </div>
          <Button href="/creator/publish" size="lg">
            {t("cta.button")}
          </Button>
        </div>
      </section>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="col" style={gap("14px")}>
      <span className="display" style={{ fontSize: 64, color: "var(--brand)" }}>
        {n}
      </span>
      <h3 className="h3">{title}</h3>
      <p className="muted">{children}</p>
    </div>
  );
}

function TrendRow({ agent: a, rank }: { agent: Agent; rank: number }) {
  const t = useTranslations("home");
  const f = useFormat();
  const cls = trendCls(a.trend7d);
  return (
    <Link className="rowline" href={agentHref(a.slug)}>
      <span className="rank">{rank}</span>
      <Tile category={a.category} size="s" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bold trunc">{a.name}</div>
        <div className="small muted trunc">
          {t("trending.meta", { category: f.categoryLabel(a.category), n: a.verifiedUses })}
          {a.trialAvailable ? ` · ${t("freeTrial")}` : ""}
        </div>
      </div>
      <span className={`trend ${cls}`} style={{ minWidth: 64, justifyContent: "flex-end" }}>
        <Icon name={cls === "up" ? "trend-up" : cls === "down" ? "trend-down" : "minus"} size="s" />
        {f.pct(a.trend7d)}
      </span>
    </Link>
  );
}

/** Card-hero "Sua licença", com o especialista mais bem avaliado. */
function HeroTicket({ agent: a, rate }: { agent: Agent; rate: number }) {
  const t = useTranslations("home.ticket");
  const f = useFormat();
  return (
    <div className="hide-m" style={{ position: "relative", minHeight: 420 }}>
      <Link href={agentHref(a.slug)} className="ticket" style={{ display: "block", transform: "rotate(2.5deg)", padding: "26px 26px 22px" }} aria-label={t("view", { name: a.name })}>
        <div className="sol-line" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, borderRadius: 0 }} />
        <div className="row between">
          <span className="eyebrow">{t("yourLicense")}</span>
          <span className="chip chip-ok">
            <Icon name="check" size="s" />
            {t("active")}
          </span>
        </div>
        <div className="row" style={gap("16px", { margin: "22px 0 20px" })}>
          <Tile category={a.category} size="l" />
          <div>
            <div className="display" style={{ fontSize: 32, lineHeight: 1.05 }}>
              {a.name}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {t("permanent")}
            </div>
          </div>
        </div>
        <div className="row wrapx" style={gap("8px")}>
          <span className="chip">{t("onSolana")}</span>
          <span className="chip">{t("updates")}</span>
        </div>
        <div className="cut" style={{ margin: "22px -26px 16px" }} />
        <div className="row between small">
          <span className="muted">{t("paymentConfirmed")}</span>
          <b className="num">{f.brl(a.priceUsdc, rate)}</b>
        </div>
      </Link>
      <div className="card pad-s row" style={gap("12px", { position: "absolute", left: -28, bottom: 6, transform: "rotate(-3deg)" })}>
        <span className="dot dot-ok">
          <Icon name="check" />
        </span>
        <div>
          <div className="bold small">{t("tested")}</div>
          <div className="tiny muted">{hasEvalScore(a.evalScore) ? t("casesSolved", { score: f.int(Math.round(a.evalScore)) }) : t("noReviews")}</div>
        </div>
      </div>
    </div>
  );
}

import type { CreatorProfile, PublicConfig } from "@solvers/api-client";
import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache, type CSSProperties } from "react";
import { clusterKey } from "@/components/catalog/cluster";
import { agentHref } from "@/components/catalog/data";
import { Button } from "@/components/ui/Button";
import { RepBadge } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { TechCard } from "@/components/ui/TechCard";
import { Tile } from "@/components/ui/Tile";
import { ApiError, serverApi } from "@/lib/api";
import { hasEvalScore } from "@/lib/eval-label";
import { explorerWallet } from "@/lib/explorer";
import { initials, starPct } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { gap } from "@/lib/style";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string; locale: string }> };

/**
 * Carteira do criador e rede, para o bloco "Verificar na blockchain". O perfil público não traz a carteira;
 * ela vem de AgentDetail.onchain.creatorWallet (de qualquer especialista publicado). null se não houver.
 */
async function loadTech(p: CreatorProfile, lang: Locale): Promise<{ wallet: string; config: PublicConfig } | null> {
  const first = p.agents[0];
  if (!first) return null;
  const api = serverApi();
  try {
    const [d, config] = await Promise.all([api.getAgent(first.slug, lang), api.getConfig()]);
    return d.onchain.creatorWallet ? { wallet: d.onchain.creatorWallet, config } : null;
  } catch {
    return null;
  }
}

const load = cache(async (id: string, lang: Locale): Promise<CreatorProfile | null> => {
  try {
    return await serverApi().getCreator(id, lang);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, locale } = await params;
  const p = await load(id, locale as Locale).catch(() => null);
  return p ? { title: p.creator.name, description: p.creator.bio } : { title: (await getTranslations({ locale, namespace: "catalog.meta" }))("creatorFallback") };
}

export default async function CreatorPage({ params }: Props) {
  const { id, locale } = await params;
  const t = await getTranslations("catalog.creator");
  const tc = await getTranslations("catalog");
  const f = await getFormat();
  let p: CreatorProfile | null;
  try {
    p = await load(id, locale as Locale);
  } catch {
    return (
      <section className="wrap sec">
        <Empty icon="warning" title={t("loadErrorTitle")} action={<Button href={`/creators/${encodeURIComponent(id)}`}>{t("retry")}</Button>}>
          {t("loadErrorBody")}
        </Empty>
      </section>
    );
  }
  if (!p) notFound();

  const c = p.creator;
  const lv = f.repLevel(c.reputationScore);
  const score = Math.round(c.reputationScore);
  const uses = p.agents.reduce((s, a) => s + a.verifiedUses, 0);
  const tech = await loadTech(p, locale as Locale);

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <div className="g2 gs2" style={gap("24px", { marginBottom: 24 })}>
        <div className="card pad-l row start m-col-x" style={gap("28px")}>
          <span className="av av-l" aria-hidden>
            {initials(c.name)}
          </span>
          <div className="col grow" style={gap("10px")}>
            <h1 className="display h2s">{c.name}</h1>
            <div className="row wrapx" style={gap("8px")}>
              <RepBadge score={c.reputationScore}>
                <span>{t("repBadge", { level: f.locale === "pt" ? lv.label.toLowerCase() : lv.label })}</span>
              </RepBadge>
              <span className="chip">
                {t("published", { count: c.agentsPublished })}
              </span>
            </div>
            {c.bio ? (
              <p className="muted" style={{ maxWidth: 560 }}>
                {c.bio}
              </p>
            ) : null}
          </div>
        </div>
        <div className="score-card score-verified row" style={gap("22px")}>
          <div className="ring" style={{ "--p": score } as CSSProperties} role="img" aria-label={t("ringAria", { score })}>
            <div>
              <span className="display num" style={{ fontSize: 38 }}>
                {score}
              </span>
            </div>
          </div>
          <div className="col" style={gap("6px")}>
            <b style={{ fontSize: 17 }}>{t("seal")}</b>
            <span className="small muted">{tc("disputes", { n: c.disputesLost })}</span>
            <span className="small muted">{t("verifiedUses", { count: uses })}</span>
          </div>
        </div>
      </div>

      <div className="card pad-s" style={{ padding: "8px 24px", marginBottom: 24 }}>
        <h2 className="h3" style={{ padding: "16px 0 4px" }}>
          {t("listTitle")}
        </h2>
        {p.agents.length === 0 ? (
          <p className="muted" style={{ padding: "12px 0 20px" }}>
            {t("listEmpty")}
          </p>
        ) : (
          p.agents.map((a) => (
            <Link key={a.id} className="rowline" href={agentHref(a.slug)}>
              <Tile category={a.category} size="s" />
              <div className="grow" style={{ minWidth: 0 }}>
                <b className="trunc" style={{ display: "block" }}>
                  {a.name}
                </b>
                <div className="small muted trunc">
                  {a.trialAvailable ? t("versionTrial", { version: a.version }) : t("version", { version: a.version })}
                </div>
              </div>
              {a.reviewsCount > 0 ? (
                <span className="row hide-m" style={gap("7px")}>
                  <span className="stars" style={{ "--p": `${starPct(a.userRating)}%` } as CSSProperties} role="img" aria-label={t("ratingAria", { rating: f.dec1(a.userRating) })} />
                  <b className="small num">{f.dec1(a.userRating)}</b>
                </span>
              ) : null}
              {hasEvalScore(a.evalScore) ? (
                <span className="verified hide-m" title={tc("eval.note")}>
                  <Icon name="shield-check" size="s" />
                  {Math.round(a.evalScore)}%
                </span>
              ) : (
                <span className="tiny faint hide-m">{tc("eval.none")}</span>
              )}
              <Icon name="chevron-right" size="s" />
            </Link>
          ))
        )}
      </div>

      <div className="card-flat" style={{ padding: "26px 28px" }}>
        <div className="row between wrapx" style={gap("16px")}>
          <div className="col" style={gap("4px")}>
            <h2 className="h3">{t("levelsTitle")}</h2>
            <span className="small muted">{t("levelsNote")}</span>
          </div>
          <ul className="row wrapx" style={gap("8px", { listStyle: "none", padding: 0, margin: 0 })}>
            {f.repLevels().map((l) => {
              const cur = l.key === lv.key;
              return (
                <li
                  key={l.key}
                  className={["rep", l.cls].filter(Boolean).join(" ")}
                  style={cur ? { outline: "2px solid var(--brand)", outlineOffset: 2 } : { opacity: 0.75 }}
                  aria-current={cur ? "true" : undefined}
                >
                  <span>
                    {l.name} · {l.range}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {tech ? (
        <TechCard
          style={{ marginTop: 24 }}
          text={t("techText")}
          rows={[
            { label: t("wallet"), value: tech.wallet, mono: true },
            { label: t("network"), value: tc(`cluster.${clusterKey(tech.config.cluster)}`) },
          ]}
          explorer={explorerWallet(tech.config, tech.wallet)}
        />
      ) : null}
    </section>
  );
}

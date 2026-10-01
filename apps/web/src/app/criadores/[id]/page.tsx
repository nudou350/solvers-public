import type { CreatorProfile, PublicConfig } from "@solvers/api-client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type CSSProperties } from "react";
import { agentHref, disputesText } from "@/components/catalog/data";
import { Button } from "@/components/ui/Button";
import { RepBadge } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { TechCard } from "@/components/ui/TechCard";
import { Tile } from "@/components/ui/Tile";
import { ApiError, serverApi } from "@/lib/api";
import { clusterName, explorerWallet } from "@/lib/explorer";
import { dec1, initials, int, REP_LEVELS, repLevel, starPct } from "@/lib/format";
import { gap } from "@/lib/style";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Carteira do criador e rede, para o bloco "Verificar na blockchain". O perfil público não traz a carteira;
 * ela vem de AgentDetail.onchain.creatorWallet (de qualquer especialista publicado). null se não houver.
 */
async function loadTech(p: CreatorProfile): Promise<{ wallet: string; config: PublicConfig } | null> {
  const first = p.agents[0];
  if (!first) return null;
  const api = serverApi();
  try {
    const [d, config] = await Promise.all([api.getAgent(first.slug), api.getConfig()]);
    return d.onchain.creatorWallet ? { wallet: d.onchain.creatorWallet, config } : null;
  } catch {
    return null;
  }
}

const load = cache(async (id: string): Promise<CreatorProfile | null> => {
  try {
    return await serverApi().getCreator(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await load(id).catch(() => null);
  return p ? { title: p.creator.name, description: p.creator.bio } : { title: "Criador" };
}

export default async function CreatorPage({ params }: Props) {
  const { id } = await params;
  let p: CreatorProfile | null;
  try {
    p = await load(id);
  } catch {
    return (
      <section className="wrap sec">
        <Empty icon="warning" title="Não deu para carregar este perfil" action={<Button href={`/criadores/${encodeURIComponent(id)}`}>Tentar de novo</Button>}>
          O servidor não respondeu agora. Tente de novo em instantes.
        </Empty>
      </section>
    );
  }
  if (!p) notFound();

  const c = p.creator;
  const lv = repLevel(c.reputationScore);
  const score = Math.round(c.reputationScore);
  const uses = p.agents.reduce((s, a) => s + a.verifiedUses, 0);
  const tech = await loadTech(p);

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
                <span>Criador {lv.label.toLowerCase()}</span>
              </RepBadge>
              <span className="chip">
                {c.agentsPublished} {c.agentsPublished === 1 ? "especialista publicado" : "especialistas publicados"}
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
          <div className="ring" style={{ "--p": score } as CSSProperties} role="img" aria-label={`Reputação ${score} de 100`}>
            <div>
              <span className="display num" style={{ fontSize: 38 }}>
                {score}
              </span>
            </div>
          </div>
          <div className="col" style={gap("6px")}>
            <b style={{ fontSize: 17 }}>Selo de reputação</b>
            <span className="small muted">{disputesText(c.disputesLost)}</span>
            <span className="small muted">{int(uses)} usos verificados</span>
          </div>
        </div>
      </div>

      <div className="card pad-s" style={{ padding: "8px 24px", marginBottom: 24 }}>
        <h2 className="h3" style={{ padding: "16px 0 4px" }}>
          Especialistas publicados
        </h2>
        {p.agents.length === 0 ? (
          <p className="muted" style={{ padding: "12px 0 20px" }}>
            Nenhum especialista na vitrine no momento.
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
                  Versão {a.version}
                  {a.trialAvailable ? " · teste grátis" : ""}
                </div>
              </div>
              {a.reviewsCount > 0 ? (
                <span className="row hide-m" style={gap("7px")}>
                  <span className="stars" style={{ "--p": `${starPct(a.userRating)}%` } as CSSProperties} role="img" aria-label={`Nota ${dec1(a.userRating)} de 5`} />
                  <b className="small num">{dec1(a.userRating)}</b>
                </span>
              ) : null}
              <span className="verified hide-m" title="Casos de teste resolvidos">
                <Icon name="shield-check" size="s" />
                {a.evalScore}%
              </span>
              <Icon name="chevron-right" size="s" />
            </Link>
          ))
        )}
      </div>

      <div className="card-flat" style={{ padding: "26px 28px" }}>
        <div className="row between wrapx" style={gap("16px")}>
          <div className="col" style={gap("4px")}>
            <h2 className="h3">Níveis de reputação</h2>
            <span className="small muted">O selo aparece no perfil, na página de cada especialista e nas garantias.</span>
          </div>
          <ul className="row wrapx" style={gap("8px", { listStyle: "none", padding: 0, margin: 0 })}>
            {REP_LEVELS.map((l) => {
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
          text="As vendas e as avaliações dos especialistas deste criador ficam registradas na rede Solana, e qualquer pessoa pode verificar."
          rows={[
            { label: "Carteira", value: tech.wallet, mono: true },
            { label: "Rede", value: clusterName(tech.config.cluster) },
          ]}
          explorer={explorerWallet(tech.config, tech.wallet)}
        />
      ) : null}
    </section>
  );
}

import type { AgentDetail, PublicConfig } from "@solvers/api-client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type CSSProperties } from "react";
import { BeforeAfterBlock, Reviews, Scores, Versions } from "@/components/catalog/AgentSections";
import { BuyBox } from "@/components/catalog/BuyBox";
import { TrialBlock } from "@/components/catalog/TrialBlock";
import { creatorHref, disputesText } from "@/components/catalog/data";
import { Button } from "@/components/ui/Button";
import { RepBadge } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { ApiError, serverApi } from "@/lib/api";
import { clusterName, explorerLink } from "@/lib/explorer";
import { brl, brlValue, categoryLabel, connectorName, durationText, initials, repLevel, usdc } from "@/lib/format";
import { gap } from "@/lib/style";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** Detalhe + config numa chamada só por requisição (metadata e página). null = não existe. */
const load = cache(async (slug: string): Promise<{ d: AgentDetail; config: PublicConfig } | null> => {
  const api = serverApi();
  try {
    const [d, config] = await Promise.all([api.getAgent(slug), api.getConfig()]);
    return { d, config };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  if (!data) return { title: "Especialista" };
  return { title: data.d.agent.name, description: data.d.agent.tagline };
}

const PACK: { icon: IconName; hue: number }[] = [
  { icon: "book", hue: 250 },
  { icon: "wrench", hue: 300 },
  { icon: "file", hue: 60 },
  { icon: "refresh", hue: 150 },
  { icon: "message", hue: 25 },
];

/** Colunas do "O que vem no pacote": até 5 numa linha; acima disso, linhas cheias de 3 ou 4. */
const packCols = (n: number) => (n <= 5 ? Math.max(2, n) : n % 3 === 0 ? 3 : 4);

export default async function AgentPage({ params }: Props) {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(slug);
  } catch {
    return (
      <section className="wrap sec">
        <Empty icon="warning" title="Não deu para carregar este especialista" action={<Button href={`/especialistas/${encodeURIComponent(slug)}`}>Tentar de novo</Button>}>
          O servidor não respondeu agora. Tente de novo em instantes.
        </Empty>
      </section>
    );
  }
  if (!data) notFound();

  const { d, config } = data;
  const a = d.agent;
  const cr = d.creator;
  const lv = repLevel(cr.reputationScore);
  const rate = config.brlPerUsd;
  const req = (t: "client" | "connector" | "plan") => a.requirements.filter((r) => r.type === t);
  const clients = req("client").map((r) => r.label);
  const connectors = req("connector");
  const plan = req("plan")[0]?.label ?? null;
  const g = d.guarantee;

  return (
    <>
      <div className="wrap" style={{ paddingTop: 28 }}>
        <nav className="crumbs" aria-label="Você está em">
          <Link href="/">Início</Link>
          <Icon name="chevron-right" size="s" />
          <Link href="/#categorias">{categoryLabel(a.category)}</Link>
          <Icon name="chevron-right" size="s" />
          <span style={{ color: "var(--ink)" }} aria-current="page">
            {a.name}
          </span>
        </nav>
      </div>

      <section className="wrap" style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div className="split">
          <div className="col" style={gap("26px")}>
            <div className="row start m-col-x" style={gap("22px")}>
              <Tile category={a.category} size="l" />
              <div className="col grow" style={gap("10px")}>
                <div className="row wrapx" style={gap("8px")}>
                  <span className="chip">{categoryLabel(a.category)}</span>
                  <span className="chip">Versão {a.version}</span>
                </div>
                <h1 className="display h1s">{a.name}</h1>
                <p className="lead">{a.tagline}</p>
              </div>
            </div>
            <div className="row wrapx card pad-s" style={gap("14px", { padding: "14px 18px" })}>
              <span className="av" aria-hidden>
                {initials(cr.name)}
              </span>
              <div className="grow" style={{ minWidth: 180 }}>
                <div className="small faint">Criado por</div>
                <Link className="bold trunc" style={{ display: "block" }} href={creatorHref(cr.id)}>
                  {cr.name}
                </Link>
              </div>
              <RepBadge score={cr.reputationScore}>
                <span>
                  {lv.label} · {cr.reputationScore}/100
                </span>
              </RepBadge>
              <span className="small muted">{disputesText(cr.disputesLost)}</span>
            </div>
            <p style={{ fontSize: 17, lineHeight: 1.65, maxWidth: 720 }}>{a.description}</p>
            <div className="row wrapx" style={gap("10px")}>
              {clients.length ? (
                <span className="chip chip-plain">
                  <Icon name="monitor" size="s" />
                  Funciona no {clients.join(" e ")}
                </span>
              ) : null}
              {connectors.map((r) => (
                <span key={r.label} className="chip chip-plain">
                  <Icon name="plug" size="s" />
                  {r.optional ? `Conector opcional: ${connectorName(r.label)}` : `Conector: ${r.label}`}
                </span>
              ))}
              {plan ? (
                <span className="chip chip-plain">
                  <Icon name="card" size="s" />
                  {plan}
                </span>
              ) : null}
            </div>
          </div>

          <aside className="sticky" aria-label="Comprar">
            <BuyBox
              slug={a.slug}
              name={a.name}
              priceUsdc={a.priceUsdc}
              priceBrl={d.priceBrl}
              trial={d.trial}
              hasGuarantee={!!g}
              rate={rate}
            />
          </aside>
        </div>
      </section>

      {d.trial ? <TrialBlock slug={a.slug} trial={d.trial} /> : null}

      <Scores
        rating={a.userRating}
        reviewsCount={a.reviewsCount}
        distribution={d.ratingDistribution}
        evalScore={a.evalScore}
        version={a.version}
        verifiedUses={a.verifiedUses}
        tech={{
          hash: a.versionHash,
          network: clusterName(config.cluster),
          account: d.onchain.agent,
          explorer: d.onchain.agent ? explorerLink(config, "address", d.onchain.agent) : null,
        }}
      />

      {g ? (
        <section className="wrap" id="garantia" style={{ paddingBottom: 64, scrollMarginTop: 24 }}>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="sol-line" style={{ borderRadius: 0, height: 4 }} />
            <div className="pad-l col" style={gap("24px")}>
              <div className="row between end wrapx" style={gap("20px")}>
                <div className="col" style={gap("8px", { maxWidth: 640 })}>
                  <span className="chip chip-ok" style={{ alignSelf: "flex-start" }}>
                    <Icon name="shield-check" size="s" />
                    Tarefa com garantia
                  </span>
                  <h2 className="display h2s">Pague só quando o resultado passar nos critérios</h2>
                  <p className="muted">
                    Você descreve a tarefa. O pagamento fica guardado e cada etapa só é liberada quando a entrega cumpre os critérios definidos pelo criador. Depois de cada entrega você tem {durationText(g.reviewWindowSecs)} para
                    revisar ou contestar.
                  </p>
                </div>
                <div className="col" style={gap("12px", { alignItems: "flex-start" })}>
                  <div className="col" style={gap("2px")}>
                    <span className="display num" style={{ fontSize: 44, lineHeight: 1 }}>
                      {brlValue(g.priceBrl)}
                    </span>
                    <span className="small faint">{usdc(g.priceUsdc)} por tarefa</span>
                  </div>
                  <Button href={`/checkout?agent=${encodeURIComponent(a.slug)}&type=guarantee`} size="lg" iconRight="arrow-right">
                    Contratar com garantia
                  </Button>
                </div>
              </div>
              <ol className={`g${Math.min(3, g.milestones.length)} m1`} style={gap("18px", { listStyle: "none", padding: 0, margin: 0 })}>
                {g.milestones.map((m, i) => (
                  <li key={i} className="card-flat pad col" style={gap("14px")}>
                    <div className="row between start" style={gap("12px")}>
                      <div className="row grow" style={gap("12px")}>
                        <span className="dot dot-now" style={{ width: 32, height: 32 } as CSSProperties}>
                          {i + 1}
                        </span>
                        <b style={{ fontSize: 17 }}>{m.title}</b>
                      </div>
                      <span className="col flex-none" style={gap("0", { alignItems: "flex-end", textAlign: "right" })}>
                        <b className="num" style={{ whiteSpace: "nowrap" }}>{brl(m.amountUsdc, rate)}</b>
                        <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{usdc(m.amountUsdc)}</span>
                      </span>
                    </div>
                    <span className={`chip ${m.verify === "tests" ? "chip-ok" : "chip-brand"}`} style={{ alignSelf: "flex-start" }}>
                      <Icon name={m.verify === "tests" ? "shield-check" : "eye"} size="s" />
                      {m.verify === "tests" ? "Verificada por testes no servidor" : "Você revisa a entrega"}
                    </span>
                    <ul className="col small" style={gap("8px")}>
                      {m.criteria.map((c) => (
                        <li key={c} className="row start" style={gap("10px")}>
                          <span className="ok">
                            <Icon name="check-circle" size="s" />
                          </span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : null}

      <BeforeAfterBlock items={d.beforeAfter} name={a.name} />

      <section className="wrap" style={{ paddingBottom: 64 }}>
        <div className="col" style={gap("8px", { marginBottom: 26 })}>
          <h2 className="display h2s">O que você precisa para usar</h2>
          <p className="muted" style={{ maxWidth: 620 }}>
            Confira antes de comprar. Na instalação guiada, cada item vira uma verificação com status.
          </p>
        </div>
        <div className="g3" style={gap("22px")}>
          <div className="card pad col" style={gap("14px")}>
            <div className="row" style={gap("12px")}>
              <span className="tile tile-s" style={{ "--h": 250 } as CSSProperties} aria-hidden>
                <Icon name="monitor" />
              </span>
              <h3 className="h4">IAs compatíveis</h3>
            </div>
            {clients.map((k) => (
              <div key={k} className="row" style={gap("10px")}>
                <span className="ok">
                  <Icon name="check-circle" />
                </span>
                <b>{k}</b>
              </div>
            ))}
            <p className="small muted">Você usa a IA que já tem. O Solver não cobra por ela.</p>
          </div>
          <div className="card pad col" style={gap("14px")}>
            <div className="row" style={gap("12px")}>
              <span className="tile tile-s" style={{ "--h": 300 } as CSSProperties} aria-hidden>
                <Icon name="plug" />
              </span>
              <h3 className="h4">Conectores necessários</h3>
            </div>
            {connectors.length ? (
              connectors.map((r) => (
                <div key={r.label} className="col" style={gap("6px")}>
                  <div className="row between" style={gap("12px")}>
                    <b className="grow">{connectorName(r.label)}</b>
                    {r.optional ? <span className="chip">Opcional</span> : <span className="chip chip-warn">Conecte na sua IA</span>}
                  </div>
                  {r.howTo ? <p className="small muted" style={{ overflowWrap: "anywhere" }}>{r.howTo}</p> : null}
                  {r.helpUrl ? (
                    <a className="link small" href={r.helpUrl} target="_blank" rel="noopener noreferrer">
                      Ajuda oficial
                    </a>
                  ) : null}
                </div>
              ))
            ) : (
              <b>Nenhum</b>
            )}
            <p className="small muted">
              {connectors.length
                ? "Um conector deixa o especialista ler e organizar seus arquivos, sempre com a sua autorização."
                : "Basta conectar o Solver à sua IA. Nenhuma outra ferramenta é necessária."}
            </p>
          </div>
          <div className="card pad col" style={gap("14px")}>
            <div className="row" style={gap("12px")}>
              <span className="tile tile-s" style={{ "--h": 150 } as CSSProperties} aria-hidden>
                <Icon name="card" />
              </span>
              <h3 className="h4">Plano recomendado</h3>
            </div>
            <b>{plan ?? "Qualquer plano"}</b>
            <p className="small muted">{plan ? "Indicado pelo criador." : "O criador não indicou um plano específico."} Conectores personalizados podem pedir um plano pago da sua IA.</p>
          </div>
        </div>
      </section>

      {a.packageContents.length ? (
        <section className="wrap" style={{ paddingBottom: 64 }}>
          <div className="col" style={gap("8px", { marginBottom: 26 })}>
            <h2 className="display h2s">O que vem no pacote</h2>
          </div>
          <div className={`g${packCols(a.packageContents.length)} m1`} style={gap("16px")}>
            {a.packageContents.map((t, i) => {
              const s = PACK[i % PACK.length] ?? PACK[0]!;
              return (
                <div key={t} className="card pad-s col" style={gap("12px")}>
                  <span className="tile tile-s" style={{ "--h": s.hue } as CSSProperties} aria-hidden>
                    <Icon name={s.icon} />
                  </span>
                  <p className="small">{t}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {d.versions.length ? (
        <section className="wrap" style={{ paddingBottom: 64 }}>
          <div className="row between end wrapx" style={gap("12px", { marginBottom: 26 })}>
            <h2 className="display h2s">Histórico de versões</h2>
            <span className="small muted">Cada versão passa pela bateria de testes antes de ser publicada.</span>
          </div>
          <Versions versions={d.versions} />
        </section>
      ) : null}

      <section className="wrap" style={{ paddingBottom: 24 }}>
        <div className="row between end wrapx" style={gap("12px", { marginBottom: 26 })}>
          <h2 className="display h2s">Avaliações</h2>
          <span className="verified">
            <Icon name="shield-check" size="s" />
            Todas de compradores verificados
          </span>
        </div>
        <Reviews slug={a.slug} initial={d.reviews} total={Math.max(a.reviewsCount, d.reviews.length)} />
      </section>
    </>
  );
}

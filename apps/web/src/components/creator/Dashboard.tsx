"use client";
import type { CreatorDashboard } from "@solvers/api-client";
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AuthGate } from "@/components/ui/AuthGate";
import { Chip, RepBadge } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Tile } from "@/components/ui/Tile";
import { ApiError } from "@/lib/api";
import { brl, brl0, date, dec1, int, usdc } from "@/lib/format";
import { useRate, useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { CreatorHead } from "./CreatorHead";
import { DailyChart } from "./DailyChart";

type Dash = CreatorDashboard;
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: Dash };

const STATUS_LABEL: Record<Dash["agents"][number]["status"], string> = { active: "no ar", pending: "em revisão", suspended: "suspenso", retired: "Aposentado" };
const RESULT: Record<Dash["disputes"][number]["result"], { label: string; chip: "warn" | "red" | "ok"; tone: string }> = {
  open: { label: "Em análise", chip: "warn", tone: "warn" },
  buyer: { label: "Favorável ao comprador", chip: "red", tone: "bad" },
  creator: { label: "Favorável ao criador", chip: "ok", tone: "ok" },
};

/** Painel do criador (/criador): exige login; sem especialistas publicados, mostra como começar. */
export function CreatorDashboardView() {
  const { api, status, me } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const data = await api.getCreatorDashboard();
      setState({ kind: "ok", data });
    } catch (e) {
      setState({ kind: "error", message: e instanceof ApiError && e.status === 401 ? "Sua sessão expirou. Entre de novo." : (e as Error).message });
    }
  }, [api]);

  useEffect(() => {
    if (status === "authed") void load();
  }, [status, me?.wallet, load]);

  if (status !== "authed")
    return (
      <Section>
        <CreatorHead tab="overview" />
        <AuthGate
          icon="pen"
          title="Entre para ver seu painel"
          text="Vendas, usos, receita e contestações dos seus especialistas ficam aqui."
          actions={
            <Button variant="secondary" href="/criador/publicar">
              Como publicar
            </Button>
          }
        />
      </Section>
    );

  if (state.kind === "loading") return <Section><CreatorHead tab="overview" /><Loading text="Carregando seu painel…" /></Section>;
  if (state.kind === "error")
    return (
      <Section>
        <CreatorHead tab="overview" />
        <Empty icon="warning" title="Não deu para carregar o painel" action={<Button onClick={() => void load()}>Tentar de novo</Button>}>
          {state.message}
        </Empty>
      </Section>
    );

  const { data } = state;
  if (!data.creator)
    return (
      <Section>
        <CreatorHead tab="overview" />
        <NotCreator sharePct={data.creatorSharePct} />
      </Section>
    );
  return (
    <Section>
      <CreatorHead tab="overview" reputation={data.creator.reputationScore} name={data.creator.name} />
      <Overview data={data} creator={data.creator} />
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      {children}
    </section>
  );
}

function NotCreator({ sharePct }: { sharePct: number }) {
  const points = [
    { icon: "gift" as const, title: "Publicar é grátis", text: "Sem depósito e sem mensalidade. Você só precisa do pacote do especialista e de uma bateria de testes." },
    { icon: "coin" as const, title: `Você recebe ${dec1(sharePct).replace(",0", "")}% de cada venda`, text: "O valor cai na sua carteira a cada licença vendida. A taxa da plataforma já está descontada." },
    { icon: "shield-check" as const, title: "Qualidade pela bateria de testes", text: "Cada especialista passa por pelo menos 30 casos de teste. A nota aparece para os compradores." },
  ];
  return (
    <div className="card pad-l col" style={gap(28)}>
      <div className="col" style={gap(10, { maxWidth: 680 })}>
        <span className="eyebrow">Comece por aqui</span>
        <h2 className="display h2s">Você ainda não publicou especialistas</h2>
        <p className="lead">Transforme o que você sabe fazer num especialista que as pessoas usam com o Claude e o ChatGPT que já têm.</p>
      </div>
      <div className="g3 m1" style={gap(16)}>
        {points.map((p) => (
          <div key={p.title} className="card-flat pad-s col" style={gap(10)}>
            <span className="brand">
              <Icon name={p.icon} />
            </span>
            <b>{p.title}</b>
            <span className="small muted">{p.text}</span>
          </div>
        ))}
      </div>
      <div className="row wrapx" style={gap(12)}>
        <Button href="/criador/publicar" size="lg" iconRight="arrow-right">
          Publicar especialista
        </Button>
      </div>
    </div>
  );
}

function Overview({ data, creator }: { data: Dash; creator: NonNullable<Dash["creator"]> }) {
  const rate = useRate();
  const resaleOn = !!useSession().config?.resaleEnabled;
  const money0 = (v: number) => (rate != null ? brl0(v, rate) : usdc(v));
  const money = (v: number) => (rate != null ? brl(v, rate) : usdc(v));
  const lost = data.totals.disputesLost;
  const lostText = lost === 0 ? "Nenhuma contestação perdida" : `${int(lost)} ${lost === 1 ? "contestação perdida" : "contestações perdidas"}`;
  const kpiN = { fontSize: 44, lineHeight: 1 } as CSSProperties;
  const kpiMoney = { fontSize: 40, lineHeight: 1, whiteSpace: "nowrap" } as CSSProperties;
  // Total desde o início, só quando difere dos últimos 30 dias.
  const allTime = (total: number, last: number) => (total > last ? ` · ${int(total)} no total` : "");
  const nameOf = new Map(data.agents.map((a) => [a.agentId, a.name]));

  return (
    <>
      <div className="g5" style={gap(16, { marginBottom: 24 })}>
        <div className="card pad-s col" style={gap(6)}>
          <span className="small muted">Vendas em 30 dias</span>
          <span className="display num" style={kpiN}>{int(data.last30.sales)}</span>
          <span className="tiny ok">licenças novas{allTime(data.totals.sales, data.last30.sales)}</span>
        </div>
        <div className="card pad-s col" style={gap(6)}>
          <span className="small muted">Usos verificados</span>
          <span className="display num" style={kpiN}>{int(data.last30.uses)}</span>
          <span className="tiny faint">nos últimos 30 dias{allTime(data.totals.uses, data.last30.uses)}</span>
        </div>
        <div className="card pad-s col" style={gap(6)}>
          <span className="small muted">Receita de vendas</span>
          <span className="display num kpi-n" style={kpiMoney}>{money0(data.last30.revenueUsdc)}</span>
          <span className="tiny faint">
            {usdc(data.last30.revenueUsdc)}
            {data.totals.salesRevenueUsdc > data.last30.revenueUsdc ? ` · ${money0(data.totals.salesRevenueUsdc)} no total` : ""}
          </span>
        </div>
        <div className="card pad-s col" style={gap(6)}>
          <span className="small muted">Royalties de revenda</span>
          {resaleOn ? (
            <>
              <span className="display num kpi-n" style={kpiMoney}>{money0(data.totals.royaltiesUsdc)}</span>
              <span className="tiny faint">{usdc(data.totals.royaltiesUsdc)} · em revendas feitas no mercado</span>
            </>
          ) : (
            <>
              <span className="display kpi-n faint" style={kpiMoney}>Em breve</span>
              <span className="tiny faint">quando o mercado de revenda abrir</span>
            </>
          )}
        </div>
        <div className="card pad-s col" style={gap(6)}>
          <span className="small muted">Contestações</span>
          <span className="display num" style={kpiN}>{int(data.totals.disputesOpened)}</span>
          <span className={data.totals.disputesOpen ? "tiny warn" : "tiny faint"}>{int(data.totals.disputesOpen)} em análise</span>
        </div>
      </div>

      <div className="g2 gs2" style={gap(24, { marginBottom: 24 })}>
        <div className="card pad">
          <DailyChart daily={data.daily} />
        </div>
        <div className="card pad col" style={gap(16, { alignItems: "flex-start" })}>
          <h2 className="h3">Seu selo de reputação</h2>
          <div className="row" style={gap(20)}>
            <div className="ring" style={{ "--p": Math.round(creator.reputationScore) } as CSSProperties}>
              <div>
                <span className="display num" style={{ fontSize: 36 }}>{Math.round(creator.reputationScore)}</span>
              </div>
            </div>
            <div className="col grow" style={gap(4)}>
              <RepBadge score={creator.reputationScore} style={{ alignSelf: "flex-start" }} />
              <span className="small muted">{lostText}</span>
            </div>
          </div>
          <p className="small muted">
            A reputação sobe com boas notas, testes aprovados e contestações resolvidas a favor do comprador. Contestações perdidas descontam pontos e reduzem a
            visibilidade.
          </p>
          <Link className="link small" href={`/criadores/${encodeURIComponent(creator.id)}`}>
            Ver meu perfil público
          </Link>
        </div>
      </div>

      <div className="card pad-s" style={{ padding: "8px 24px", marginBottom: 24 }}>
        <div className="row between wrapx" style={{ padding: "14px 0" }}>
          <h2 className="h3">Seus especialistas</h2>
          <Button variant="secondary" href="/criador/publicar" icon="plus">
            Publicar novo
          </Button>
        </div>
        {data.agents.length === 0 ? (
          <div style={{ borderTop: "1px solid var(--line)" }}>
            <Empty bare icon="pen" title="Nenhum especialista ainda">
              Publique o primeiro: é grátis e sem depósito.
            </Empty>
          </div>
        ) : (
          <>
            <div className="cr-table cr-head hide-m" aria-hidden>
              <span>Especialista</span>
              <span>Vendidas / Teto</span>
              <span>Usos</span>
              <span>Nota</span>
              <span>Desempenho</span>
              <span>Receita</span>
            </div>
            {data.agents.map((a) => {
              return (
                <div key={a.agentId} className="cr-table">
                  <span className="row" style={gap(12, { minWidth: 0 })}>
                    <Tile category={a.category} size="s" />
                    <span className="col" style={gap(4, { minWidth: 0 })}>
                      <Link className="trunc bold" href={`/especialistas/${encodeURIComponent(a.slug)}`} style={{ fontWeight: 700 }}>
                        {a.name}
                      </Link>
                      <span className="tiny faint">
                        v{a.version} · {STATUS_LABEL[a.status]}
                      </span>
                      {!a.listed ? (
                        <span>
                          <Chip tone="warn" icon="eye">Fora da vitrine (nota baixa)</Chip>
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="num">
                    <span className="only-m tiny faint">Vendidas / Teto </span>
                    {int(a.sales)}
                    {a.supply.max != null ? (
                      <span className={a.supply.left === 0 ? "warn" : "faint"}>
                        {" / "}
                        {int(a.supply.max)}
                        {a.supply.left === 0 ? " esgotado" : ""}
                      </span>
                    ) : (
                      <span className="faint" title="Sem limite de licenças">
                        {" / ∞"}
                      </span>
                    )}
                  </span>
                  <span className="num">
                    <span className="only-m tiny faint">Usos </span>
                    {int(a.uses)}
                  </span>
                  <span className="num">
                    <span className="only-m tiny faint">Nota </span>
                    {a.userRating > 0 ? dec1(a.userRating) : "—"}
                  </span>
                  <span className={["num", a.evalScore >= 80 ? "ok" : "warn"].join(" ")}>
                    <span className="only-m tiny faint">Desempenho </span>
                    {Math.round(a.evalScore)}%
                  </span>
                  <b className="num">
                    <span className="only-m tiny faint">Receita </span>
                    {money0(a.revenueUsdc)}
                  </b>
                </div>
              );
            })}
          </>
        )}
      </div>

      {data.guarantee ? (
        <div className="card pad-s" style={{ padding: "8px 24px", marginBottom: 24 }}>
          <div className="row between wrapx" style={{ padding: "14px 0" }}>
            <h2 className="h3">Ganhos de tarefas com garantia</h2>
            <span className="small muted">Já sem a taxa da plataforma, à parte das vendas</span>
          </div>
          <div className="g3 m1" style={gap(16, { padding: "4px 0 18px", borderTop: "1px solid var(--line)" })}>
            <div className="col" style={gap(4, { paddingTop: 14 })}>
              <span className="small muted">Recebido no total</span>
              <span className="display num" style={{ fontSize: 34, lineHeight: 1, whiteSpace: "nowrap" }}>{money0(data.guarantee.earnedUsdc)}</span>
              <span className="tiny faint">{usdc(data.guarantee.earnedUsdc)}</span>
            </div>
            <div className="col" style={gap(4, { paddingTop: 14 })}>
              <span className="small muted">Últimos 30 dias</span>
              <span className="display num" style={{ fontSize: 34, lineHeight: 1, whiteSpace: "nowrap" }}>{money0(data.guarantee.last30Usdc)}</span>
              <span className="tiny faint">{usdc(data.guarantee.last30Usdc)}</span>
            </div>
            <div className="col" style={gap(4, { paddingTop: 14 })}>
              <span className="small muted">Etapas liberadas</span>
              <span className="display num" style={{ fontSize: 34, lineHeight: 1 }}>{int(data.guarantee.releases)}</span>
              <span className="tiny faint">aprovadas pelo comprador, automáticas ou a seu favor</span>
            </div>
          </div>
          {data.guarantee.recent.length === 0 ? (
            <div style={{ borderTop: "1px solid var(--line)" }}>
              <Empty bare icon="shield-check" title="Nenhum pagamento de garantia ainda">
                Quando uma etapa de tarefa com garantia for liberada para você, ela aparece aqui.
              </Empty>
            </div>
          ) : (
            data.guarantee.recent.map((r) => (
              <div key={r.signature} className="rowline">
                <span className="ok">
                  <Icon name="shield-check" size="s" />
                </span>
                <div className="grow col" style={gap(2, { minWidth: 0 })}>
                  <b className="trunc">{(r.agentId && nameOf.get(r.agentId)) || "Tarefa com garantia"}</b>
                  <span className="tiny faint">{date(r.at)}</span>
                </div>
                <b className="num">{money(r.amountUsdc)}</b>
              </div>
            ))
          )}
        </div>
      ) : null}

      <div className="card pad-s" style={{ padding: "8px 24px" }}>
        <div className="row between wrapx" style={{ padding: "14px 0" }}>
          <h2 className="h3">Contestações recentes</h2>
          <span className="small muted">{lostText}</span>
        </div>
        {data.disputes.length === 0 ? (
          <div style={{ borderTop: "1px solid var(--line)" }}>
            <Empty bare icon="flag" title="Nenhuma contestação até agora">
              Quando um comprador contestar uma etapa de garantia, o critério e o motivo aparecem aqui.
            </Empty>
          </div>
        ) : (
          data.disputes.map((d) => {
            const r = RESULT[d.result];
            return (
              <div key={`${d.escrowId}-${d.index}`} className="rowline start" style={{ alignItems: "flex-start" }}>
                <span className={r.tone} style={{ marginTop: 2 }}>
                  <Icon name="flag" size="s" />
                </span>
                <div className="grow col" style={gap(3, { minWidth: 0 })}>
                  <span className="only-m" style={{ marginBottom: 4 }}><Chip tone={r.chip}>{r.label}</Chip></span>
                  <b>{d.taskTitle}</b>
                  <div className="small muted">
                    {nameOf.get(d.agentId) ? `${nameOf.get(d.agentId)} · ` : ""}Etapa {d.index + 1}: {d.milestoneTitle}
                  </div>
                  <div className="small muted">Critério apontado: {d.criterion ?? "não informado"}</div>
                  {d.reason ? <div className="small" style={{ color: "var(--ink-2)" }}>“{d.reason}”</div> : null}
                  <div className="tiny faint">
                    {d.openedAt ? date(d.openedAt) : "Data não informada"} · {money(d.amountUsdc)}
                  </div>
                </div>
                <span className="hide-m"><Chip tone={r.chip}>{r.label}</Chip></span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

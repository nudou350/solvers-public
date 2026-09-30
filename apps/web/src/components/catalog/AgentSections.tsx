"use client";
// Partes interativas da página do especialista: notas + detalhes técnicos, antes e depois, versões e avaliações.
import type { AgentVersion, BeforeAfter, Review } from "@solvers/api-client";
import { useState, type CSSProperties } from "react";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api";
import { date, dec1, initials, int, short, starPct } from "@/lib/format";
import { gap } from "@/lib/style";

/** Detalhes técnicos da versão: impressão digital, conta do especialista na rede (AgentDetail.onchain.agent) e rede. */
export type TechInfo = { hash: string; network: string; account: string | null; explorer: string | null };

/** As três notas (pessoas, comprovado, usos) e os detalhes técnicos da versão. */
export function Scores({
  rating,
  reviewsCount,
  distribution,
  evalScore,
  version,
  verifiedUses,
  tech,
}: {
  rating: number;
  reviewsCount: number;
  distribution: number[];
  evalScore: number;
  version: string;
  verifiedUses: number;
  tech: TechInfo;
}) {
  const [open, setOpen] = useState(false);
  const total = distribution.reduce((s, n) => s + n, 0);
  return (
    <section className="wrap" style={{ paddingBottom: 64 }}>
      <div className="g3 gn3" style={gap("22px")}>
        <div className="score-card score-users col" style={gap("16px")}>
          <div className="row" style={gap("8px")}>
            <span className="warn">
              <Icon name="users" />
            </span>
            <span className="eyebrow" style={{ color: "var(--amber)" }}>
              O que as pessoas acharam
            </span>
          </div>
          {reviewsCount > 0 ? (
            <>
              <div className="row" style={gap("16px", { alignItems: "flex-end" })}>
                <span className="display big num" style={{ lineHeight: 0.9 }}>
                  {dec1(rating)}
                </span>
                <div className="col" style={gap("4px", { paddingBottom: 6 })}>
                  <span className="stars" style={{ "--p": `${starPct(rating)}%` } as CSSProperties} role="img" aria-label={`Nota ${dec1(rating)} de 5`} />
                  <span className="small muted">{int(reviewsCount)} {reviewsCount === 1 ? "avaliação" : "avaliações"}</span>
                </div>
              </div>
              <div className="col" style={gap("8px")}>
                {distribution.map((n, i) => {
                  const p = total ? Math.round((n / total) * 100) : 0;
                  return (
                    <div key={i} className="row" style={gap("10px")}>
                      <span className="small num" style={{ width: 26 }}>
                        {5 - i}★
                      </span>
                      <div className="bar amber grow" role="img" aria-label={`${5 - i} estrelas: ${p}%`}>
                        <i style={{ width: `${p}%` }} />
                      </div>
                      <span className="small faint num" style={{ width: 36, textAlign: "right" }}>
                        {p}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted">Ainda sem avaliações. As primeiras chegam depois das primeiras compras.</p>
          )}
          <p className="tiny faint">Só quem comprou pode avaliar.</p>
        </div>

        <div className="score-card score-verified col" style={gap("16px")}>
          <div className="row" style={gap("8px")}>
            <span className="ok">
              <Icon name="shield-check" />
            </span>
            <span className="eyebrow" style={{ color: "var(--mint)" }}>
              O que foi comprovado
            </span>
          </div>
          <div className="row" style={gap("20px")}>
            <div className="ring" style={{ "--p": evalScore } as CSSProperties}>
              <div>
                <span className="display num" style={{ fontSize: 36 }}>
                  {evalScore}%
                </span>
              </div>
            </div>
            <div className="col" style={gap("4px")}>
              <b style={{ fontSize: 17, lineHeight: 1.3 }}>dos casos de teste resolvidos</b>
              <span className="small muted">Bateria aplicada de forma independente em cada versão. Esta é a {version}.</span>
            </div>
          </div>
          <div className="col" style={gap("4px")}>
            <div className="row between small">
              <span className="muted">Com o especialista</span>
              <b className="num ok">{evalScore}%</b>
            </div>
            <div className="bar mint">
              <i style={{ width: `${evalScore}%` }} />
            </div>
          </div>
          <button type="button" className="link-btn small" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="tech" style={{ alignSelf: "flex-start" }}>
            {open ? "Ocultar detalhes técnicos" : "Verificar na blockchain"}
          </button>
        </div>

        <div className="card pad col" style={gap("14px", { justifyContent: "space-between" })}>
          <span className="chip chip-brand" style={{ alignSelf: "flex-start" }}>
            <Icon name="bolt" size="s" />
            Uso comprovado
          </span>
          <div>
            <div className="display big num" style={{ lineHeight: 0.95 }}>
              {int(verifiedUses)}
            </div>
            <div className="bold" style={{ marginTop: 6 }}>
              usos verificados
            </div>
          </div>
          <p className="small muted">Contamos apenas usos confirmados pelo conector. Não dá para inflar o número.</p>
        </div>
      </div>
      {open ? (
        <dl className="tech" id="tech" style={{ marginTop: 16 }}>
          <dt>Impressão digital desta versão</dt>
          <dd className="mono">{tech.hash}</dd>
          {tech.account ? (
            <>
              <dt>Registro da versão na rede</dt>
              <dd className="mono">{tech.account}</dd>
            </>
          ) : null}
          <dt>Rede</dt>
          <dd>{tech.network}</dd>
          {tech.explorer ? (
            <a className="link small" href={tech.explorer} target="_blank" rel="noopener noreferrer">
              Abrir no explorador da rede <Icon name="external" size="s" />
            </a>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

/** "Antes e depois": o mesmo pedido, sem e com o especialista. Com mais de um exemplo, abas para trocar. */
export function BeforeAfterBlock({ items, name }: { items: BeforeAfter[]; name: string }) {
  const [i, setI] = useState("0");
  const cur = items[Number(i)] ?? items[0];
  if (!cur) return null;
  return (
    <section className="wrap" style={{ paddingBottom: 64 }}>
      <div className="col" style={gap("8px", { marginBottom: 26 })}>
        <h2 className="display h2s">Antes e depois</h2>
        <p className="muted" style={{ maxWidth: 620 }}>
          Mesmo pedido, duas respostas. À esquerda, a IA sozinha; à direita, com o {name} conectado.
        </p>
      </div>
      {items.length > 1 ? (
        <Tabs
          aria-label="Exemplos"
          value={i}
          onChange={setI}
          tabs={items.map((_, k) => ({ id: String(k), label: `Exemplo ${k + 1}` }))}
          className="ba-tabs"
        />
      ) : null}
      <div className="card pad-s row start" style={gap("12px", { margin: items.length > 1 ? "18px 0 22px" : "0 0 22px" })} role="tabpanel">
        <span className="av av-s">Eu</span>
        <p className="bubble me grow" style={{ borderRadius: 16 }}>
          {cur.prompt}
        </p>
      </div>
      <div className="g2" style={gap("22px")}>
        <div className="card-flat pad col" style={gap("18px")}>
          <div className="row between">
            <b>A IA sozinha</b>
            <span className="chip">Resposta genérica</span>
          </div>
          <p className="muted">“{cur.withoutSolver}”</p>
        </div>
        <div className="card pad col" style={gap("18px", { borderColor: "color-mix(in oklab,var(--mint) 40%,var(--line))" })}>
          <div className="row between">
            <b>Com o especialista</b>
            <span className="chip chip-ok">
              <Icon name="check" size="s" />
              Pronto para usar
            </span>
          </div>
          <p>“{cur.withSolver}”</p>
        </div>
      </div>
    </section>
  );
}

/** Histórico de versões: a atual e, ao expandir, todas. */
export function Versions({ versions }: { versions: AgentVersion[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? versions : versions.slice(0, 1);
  return (
    <div className="card pad-s" style={{ padding: "6px 24px" }}>
      {shown.map((v, i) => (
        <div key={v.version} className="rowline start">
          <span className={`chip${i === 0 ? " chip-ok" : ""}`} style={{ minWidth: 74, justifyContent: "center" }}>
            {v.version}
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">{v.notes || "Sem notas desta versão."}</div>
            <div className="small muted">
              {date(v.releasedAt)}
              {v.evalScore != null ? ` · ${v.evalScore}% nos testes` : ""}
              {v.versionHash ? (
                <>
                  {" · "}
                  <span className="mono" title={v.versionHash}>
                    {v.versionHash.slice(0, 15)}…
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ))}
      {versions.length > 1 ? (
        <div className="rowline">
          <button type="button" className="link-btn" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? "Mostrar só a versão atual" : `Ver histórico completo (${versions.length} versões)`}
            <Icon name="chevron-down" size="s" style={all ? { transform: "rotate(180deg)" } : undefined} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

const FIRST = 6;

/** Avaliações: as primeiras e, em "ver todas", a lista completa de getReviews(). */
export function Reviews({ slug, initial, total }: { slug: string; initial: Review[]; total: number }) {
  const [list, setList] = useState(initial.slice(0, FIRST));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const more = total > list.length;

  const loadAll = () => {
    setLoading(true);
    setFailed(false);
    api.getReviews(slug).then(
      (r) => {
        setList(r);
        setLoading(false);
      },
      () => {
        setFailed(true);
        setLoading(false);
      },
    );
  };

  if (list.length === 0)
    return <div className="card-flat pad center muted">Ainda não há avaliações. Só quem compra pode avaliar, então elas chegam com as primeiras compras.</div>;

  return (
    <>
      <div className="g2" style={gap("18px")}>
        {list.map((r) => {
          // Nome do perfil de quem avaliou; sem ele, a carteira encurtada.
          const who = r.authorName?.trim() || `Comprador ${short(r.authorWallet)}`;
          return (
            <article key={r.id} className="card pad-s col" style={gap("12px")}>
              <div className="row" style={gap("12px")}>
                <span className="av" aria-hidden>
                  {r.authorName?.trim() ? initials(r.authorName) : r.authorWallet.slice(0, 2).toUpperCase()}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="trunc" style={{ display: "block" }}>
                    {who}
                  </b>
                  <Ago className="tiny faint" iso={r.createdAt} />
                </div>
                <span className="chip chip-ok">
                  <Icon name="shield-check" size="s" />
                  Compra verificada
                </span>
              </div>
              <span className="stars" style={{ "--p": `${starPct(r.rating)}%` } as CSSProperties} role="img" aria-label={`${r.rating} de 5`} />
              <p className="muted">{r.text}</p>
            </article>
          );
        })}
      </div>
      {failed ? (
        <p className="small muted center" role="alert" style={{ marginTop: 16 }}>
          Não deu para carregar as outras avaliações agora.
        </p>
      ) : null}
      {more ? (
        <div className="row" style={{ justifyContent: "center", marginTop: 24 }}>
          <Button variant="secondary" loading={loading} onClick={loadAll}>
            Ver todas as {int(total)} avaliações
          </Button>
        </div>
      ) : null}
    </>
  );
}

"use client";
// Seção "Em teste grátis" da biblioteca: o saldo de cada teste em andamento, para ver o que resta sem abrir o especialista.
import type { Agent, MyTrial } from "@solvers/api-client";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { date, int } from "@/lib/format";
import { gap } from "@/lib/style";

export function TrialsSection({ trials, agents }: { trials: MyTrial[]; agents: Map<string, Agent> }) {
  return (
    <section className="col" style={gap("14px")} aria-label="Testes grátis em andamento">
      <h2 className="h4">Em teste grátis</h2>
      {trials.map((t) => (
        <TrialCard key={t.agentId} trial={t} agent={agents.get(t.agentId)} />
      ))}
    </section>
  );
}

function TrialCard({ trial: t, agent: a }: { trial: MyTrial; agent: Agent | undefined }) {
  const done = t.usesLeft <= 0;
  const used = t.uses - t.usesLeft;
  const slug = a ? encodeURIComponent(a.slug) : null;
  return (
    <article className="card pad-s col" style={gap("16px")}>
      <div className="row between wrapx" style={gap("12px")}>
        <div className="row" style={gap("14px", { minWidth: 0 })}>
          {a ? <Tile category={a.category} /> : <span className="tile" aria-hidden />}
          <div className="grow" style={{ minWidth: 0 }}>
            <h3 className="h4 trunc">{a?.name ?? "Especialista"}</h3>
            <div className="tiny faint">último uso em {date(t.lastUsedAt)}</div>
          </div>
        </div>
        {done ? (
          <Chip tone="warn" icon="lock">
            Teste esgotado
          </Chip>
        ) : (
          <Chip tone="brand" icon="gift">
            Teste grátis
          </Chip>
        )}
      </div>

      <div className="col" style={gap("8px")}>
        <div className="row between" style={gap("12px")}>
          <b>{done ? `Você usou os ${int(t.uses)} usos grátis` : `${used} de ${int(t.uses)} usos gastos`}</b>
          {done ? null : <span className="small muted">{t.usesLeft === 1 ? "Resta 1 uso" : `Restam ${int(t.usesLeft)} usos`}</span>}
        </div>
        <div
          className={done ? "bar amber" : "bar"}
          role="progressbar"
          aria-label="Usos grátis gastos"
          aria-valuemin={0}
          aria-valuemax={t.uses}
          aria-valuenow={used}
        >
          <i style={{ width: `${Math.min(100, (used / t.uses) * 100)}%` }} />
        </div>
      </div>

      {done ? (
        <p className="small muted">O teste acabou. Com a licença vitalícia você usa sem esses limites.</p>
      ) : (
        <ul className="small row wrapx" style={gap("8px 20px")}>
          {t.searches > 0 ? <Left icon="search">{int(t.searchesLeft)} de {int(t.searches)} consultas à base</Left> : null}
          {t.tools.map((x) => (
            <Left key={x.name} icon="wrench">
              {x.name}: {int(x.left)} de {int(x.limit)}×
            </Left>
          ))}
        </ul>
      )}

      {slug ? (
        <div className="row wrapx" style={gap("8px", { justifyContent: "flex-end" })}>
          {done ? null : (
            <Button variant="secondary" icon="play" href={`/install?agent=${slug}`}>
              Continuar testando
            </Button>
          )}
          <Button variant={done ? "primary" : "ghost"} href={`/checkout?agent=${slug}&type=permanent`}>
            Comprar licença
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function Left({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="row" style={gap("8px")}>
      <span className="faint">
        <Icon name={icon} size="s" />
      </span>
      <span>{children}</span>
    </li>
  );
}

"use client";
// Seção "Em teste grátis" da biblioteca: o saldo de cada teste em andamento, para ver o que resta sem abrir o especialista.
import type { Agent, MyTrial } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { useFormat } from "@/lib/format";
import { gap } from "@/lib/style";

export function TrialsSection({ trials, agents }: { trials: MyTrial[]; agents: Map<string, Agent> }) {
  const t = useTranslations("account.trials");
  return (
    <section className="col" style={gap("14px")} aria-label={t("region")}>
      <h2 className="h4">{t("heading")}</h2>
      {trials.map((tr) => (
        <TrialCard key={tr.agentId} trial={tr} agent={agents.get(tr.agentId)} />
      ))}
    </section>
  );
}

function TrialCard({ trial: tr, agent: a }: { trial: MyTrial; agent: Agent | undefined }) {
  const t = useTranslations("account");
  const f = useFormat();
  const done = tr.usesLeft <= 0;
  const used = tr.uses - tr.usesLeft;
  const slug = a ? encodeURIComponent(a.slug) : null;
  return (
    <article className="card pad-s col" style={gap("16px")}>
      <div className="row between wrapx" style={gap("12px")}>
        <div className="row" style={gap("14px", { minWidth: 0 })}>
          {a ? <Tile category={a.category} /> : <span className="tile" aria-hidden />}
          <div className="grow" style={{ minWidth: 0 }}>
            <h3 className="h4 trunc">{a?.name ?? t("shared.unnamedSolver")}</h3>
            <div className="tiny faint">{t("trials.lastUsed", { date: f.date(tr.lastUsedAt) })}</div>
          </div>
        </div>
        {done ? (
          <Chip tone="warn" icon="lock">
            {t("trials.exhausted")}
          </Chip>
        ) : (
          <Chip tone="brand" icon="gift">
            {t("trials.chip")}
          </Chip>
        )}
      </div>

      <div className="col" style={gap("8px")}>
        <div className="row between" style={gap("12px")}>
          <b>{done ? t("trials.usedAll", { n: f.int(tr.uses) }) : t("trials.spent", { used, total: f.int(tr.uses) })}</b>
          {done ? null : <span className="small muted">{t("trials.left", { n: tr.usesLeft })}</span>}
        </div>
        <div
          className={done ? "bar amber" : "bar"}
          role="progressbar"
          aria-label={t("trials.progress")}
          aria-valuemin={0}
          aria-valuemax={tr.uses}
          aria-valuenow={used}
        >
          <i style={{ width: `${Math.min(100, (used / tr.uses) * 100)}%` }} />
        </div>
      </div>

      {done ? (
        <p className="small muted">{t("trials.ended")}</p>
      ) : (
        <ul className="small row wrapx" style={gap("8px 20px")}>
          {tr.searches > 0 ? <Left icon="search">{t("trials.searches", { left: f.int(tr.searchesLeft), total: f.int(tr.searches) })}</Left> : null}
          {tr.tools.map((x) => (
            <Left key={x.name} icon="wrench">
              {t("trials.toolLeft", { name: x.name, left: f.int(x.left), limit: f.int(x.limit) })}
            </Left>
          ))}
        </ul>
      )}

      {slug ? (
        <div className="row wrapx" style={gap("8px", { justifyContent: "flex-end" })}>
          {done ? null : (
            <Button variant="secondary" icon="play" href={`/install?agent=${slug}`}>
              {t("trials.keepTesting")}
            </Button>
          )}
          <Button variant={done ? "primary" : "ghost"} href={`/checkout?agent=${slug}&type=permanent`}>
            {t("trials.buy")}
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

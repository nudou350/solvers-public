"use client";
// Bloco "Teste grátis" da página do especialista: o que o teste libera, os limites e, logado, o que resta.
import type { TrialInfo } from "@solvers/api-client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { int } from "@/lib/format";
import { useMyAccess } from "@/lib/hooks";
import { gap } from "@/lib/style";

/** "1 uso grátis" / "3 usos grátis". */
export const usesText = (n: number) => (n === 1 ? "1 uso grátis" : `${int(n)} usos grátis`);

const stepsText = (steps: number, total: number) =>
  steps >= total ? `Todas as ${total} etapas` : steps === 1 ? `Etapa 1 de ${total}` : `Etapas 1 a ${steps} de ${total}`;

const searchesText = (n: number) => (n > 0 ? `Até ${int(n)} ${n === 1 ? "consulta" : "consultas"} à base do especialista` : "Sem consultas à base do especialista");

export function TrialBlock({ slug, trial }: { slug: string; trial: TrialInfo }) {
  const access = useMyAccess(slug);
  const owned = !!access?.license;
  const left = access && !owned ? access : null;

  return (
    <section className="wrap" id="teste-gratis" style={{ paddingBottom: 64, scrollMarginTop: 24 }}>
      <div className="card pad-l col" style={gap("24px")}>
        <div className="col" style={gap("8px", { maxWidth: 680 })}>
          <div>
            <Chip tone="brand" icon="gift">
              Teste grátis
            </Chip>
          </div>
          <h2 className="display h2s">{usesText(trial.uses)}</h2>
          <p className="muted">{trial.summary}</p>
        </div>

        <div className="g2" style={gap("24px")}>
          <div className="col" style={gap("12px")}>
            <span className="label">Limites do teste</span>
            <ul className="col small" style={gap("10px")}>
              <Item icon="layers">{stepsText(trial.steps, trial.totalSteps)}</Item>
              <Item icon="search">{searchesText(trial.searches)}</Item>
              {trial.tools.map((t) => (
                <Item key={t.name} icon="wrench">
                  {t.name}: {int(t.limit)}×
                </Item>
              ))}
            </ul>
          </div>
          <div className="col" style={gap("12px")}>
            <span className="label">Só com a licença</span>
            <div className="row start small" style={gap("10px")}>
              <span className="faint">
                <Icon name="lock" size="s" />
              </span>
              <span>{trial.lockedSummary}</span>
            </div>
          </div>
        </div>

        {owned ? (
          <p className="small ok row" style={gap("8px")} role="status">
            <Icon name="check-circle" size="s" />
            Você tem a licença: use sem esses limites.
          </p>
        ) : left ? (
          <div className="card-flat pad-s col" style={gap("10px")} role="status">
            <b>O que resta para você</b>
            {left.trialUsesLeft > 0 ? (
              <ul className="col small" style={gap("8px")}>
                <Item icon="gift">
                  {int(left.trialUsesLeft)} de {usesText(trial.uses)}
                </Item>
                {left.trial ? (
                  <>
                    <Item icon="search">
                      {int(left.trial.searchesLeft)} {left.trial.searchesLeft === 1 ? "consulta" : "consultas"} à base do especialista
                    </Item>
                    {trial.tools.map((t) => (
                      <Item key={t.name} icon="wrench">
                        {t.name}: {int(left.trial?.toolsLeft[t.name] ?? 0)} de {int(t.limit)}×
                      </Item>
                    ))}
                  </>
                ) : null}
              </ul>
            ) : (
              <span className="small muted">Seu teste grátis acabou. Para continuar, compre a licença.</span>
            )}
          </div>
        ) : null}

        {owned || (left && left.trialUsesLeft <= 0) ? null : (
          <div>
            <Button href={`/instalar?agent=${encodeURIComponent(slug)}`} variant="secondary" icon="play">
              Testar grátis
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function Item({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="row start" style={gap("10px")}>
      <span className="faint">
        <Icon name={icon} size="s" />
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}

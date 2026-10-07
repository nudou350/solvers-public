"use client";
// Bloco "Teste grátis" da página do especialista: o que o teste libera, os limites e, logado, o que resta.
import type { TrialInfo } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useFormat } from "@/lib/format";
import { useMyAccess } from "@/lib/hooks";
import { gap } from "@/lib/style";

export function TrialBlock({ slug, trial }: { slug: string; trial: TrialInfo }) {
  const t = useTranslations("catalog.trial");
  const f = useFormat();
  const usesText = (n: number) => t("uses", { n });
  const stepsText = (steps: number, total: number) =>
    steps >= total ? t("stepsAll", { total }) : steps === 1 ? t("stepOne", { total }) : t("stepsRange", { steps, total });
  const searchesText = (n: number) => (n > 0 ? t("searches", { n }) : t("noSearches"));
  const access = useMyAccess(slug);
  const owned = !!access?.license;
  const left = access && !owned ? access : null;

  return (
    <section className="wrap" id="teste-gratis" style={{ paddingBottom: 64, scrollMarginTop: 24 }}>
      <div className="card pad-l col" style={gap("24px")}>
        <div className="col" style={gap("8px", { maxWidth: 680 })}>
          <div>
            <Chip tone="brand" icon="gift">
              {t("badge")}
            </Chip>
          </div>
          <h2 className="display h2s">{usesText(trial.uses)}</h2>
          <p className="muted">{trial.summary}</p>
        </div>

        <div className="g2" style={gap("24px")}>
          <div className="col" style={gap("12px")}>
            <span className="label">{t("limits")}</span>
            <ul className="col small" style={gap("10px")}>
              <Item icon="layers">{stepsText(trial.steps, trial.totalSteps)}</Item>
              <Item icon="search">{searchesText(trial.searches)}</Item>
              {trial.scope ? <Item icon="layers">{trial.scope}</Item> : null}
              {trial.tools.map((tool) => (
                <Item key={tool.name} icon="wrench">
                  {t("toolLimit", { name: tool.name, limit: f.int(tool.limit) })}
                </Item>
              ))}
            </ul>
          </div>
          <div className="col" style={gap("12px")}>
            <span className="label">{t("licenseOnly")}</span>
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
            {t("owned")}
          </p>
        ) : left ? (
          <div className="card-flat pad-s col" style={gap("10px")} role="status">
            <b>{t("leftTitle")}</b>
            {left.trialUsesLeft > 0 ? (
              <ul className="col small" style={gap("8px")}>
                <Item icon="gift">
                  {t("usesLeft", { left: f.int(left.trialUsesLeft), uses: usesText(trial.uses) })}
                </Item>
                {left.trial ? (
                  <>
                    <Item icon="search">
                      {t("searchesLeft", { n: left.trial.searchesLeft })}
                    </Item>
                    {trial.tools.map((tool) => (
                      <Item key={tool.name} icon="wrench">
                        {t("toolLeft", { name: tool.name, left: f.int(left.trial?.toolsLeft[tool.name] ?? 0), limit: f.int(tool.limit) })}
                      </Item>
                    ))}
                  </>
                ) : null}
              </ul>
            ) : (
              <span className="small muted">{t("over")}</span>
            )}
          </div>
        ) : null}

        {owned || (left && left.trialUsesLeft <= 0) ? null : (
          <div>
            <Button href={`/install?agent=${encodeURIComponent(slug)}`} variant="secondary" icon="play">
              {t("tryFree")}
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

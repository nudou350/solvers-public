// Peças compartilhadas do acompanhamento (criador) e da revisão (admin).
// SEGURANÇA: todo texto vindo do criador (nome, manifesto, mensagens, arquivos) entra aqui como TEXTO do React
// (escapado). Nada de dangerouslySetInnerHTML, de Markdown renderizado nem de links montados a partir do conteúdo.
import type { SubmissionStatus, SubmissionView, ValidationReport } from "@solvers/api-client";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { CHIP_TONE, STAGES, stageStates, statusInfo, type StageState } from "@/lib/submissions-ui";
import { gap } from "@/lib/style";
import s from "./creator.module.css";

export function StatusChip({ status, nextAction }: { status: SubmissionStatus; nextAction?: SubmissionView["nextAction"] }) {
  const info = statusInfo(status, nextAction);
  return <Chip tone={CHIP_TONE[info.tone]}>{info.label}</Chip>;
}

const STAGE_LABEL: Record<StageState, string> = {
  done: "concluído",
  current: "em andamento",
  attention: "precisa de atenção",
  failed: "não passou",
  todo: "ainda não chegou",
  skipped: "não se aplica a esta atualização",
};

/** Linha do tempo dos estados da PACKAGE_SPEC.md 14.2 em linguagem simples. */
export function Timeline({ status, nextAction }: { status: SubmissionStatus; nextAction?: SubmissionView["nextAction"] }) {
  const states = stageStates(status, nextAction);
  return (
    <ol className={s.timeline} aria-label="Andamento do envio">
      {STAGES.map((st, i) => {
        const state = states[i] ?? "todo";
        const dot = state === "done" ? "dot dot-ok" : state === "current" ? "dot dot-now" : state === "failed" ? "dot dot-bad" : state === "attention" ? "dot dot-now" : "dot";
        return (
          <li key={st.key} className={[s.tl, state === "done" ? s.tlDone : "", state === "skipped" ? s.tlSkipped : ""].filter(Boolean).join(" ")} aria-current={state === "current" || state === "attention" ? "step" : undefined}>
            <span className={dot} aria-hidden style={state === "attention" ? { borderColor: "var(--amber)", color: "var(--amber)", background: "var(--amber-soft)" } : undefined}>
              {state === "done" ? <Icon name="check" size="s" /> : state === "failed" ? <Icon name="x" size="s" /> : state === "attention" ? <Icon name="warning" size="s" /> : i + 1}
            </span>
            <div className={s.tlBody}>
              <b>{st.title}</b>
              <span className="sr-only" style={srOnly}>
                {" "}
                ({STAGE_LABEL[state]})
              </span>
              <div className="small muted">{st.text}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const srOnly = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

/** Erros (bloqueiam o envio) e avisos (vão ao revisor) do validador, com código, caminho e o que corrigir. */
export function ValidationList({ report }: { report: ValidationReport | null }) {
  if (!report) return null;
  const { errors, warnings } = report;
  if (errors.length === 0 && warnings.length === 0)
    return (
      <p className="small ok" role="status">
        <Icon name="check-circle" size="s" /> A conferência automática não achou erros nem avisos.
      </p>
    );
  return (
    <div className="col" style={gap(18)}>
      {errors.length ? (
        <section className="col" style={gap(10)} aria-labelledby="val-errors">
          <h3 className="h4" id="val-errors">
            {errors.length === 1 ? "1 erro para corrigir" : `${errors.length} erros para corrigir`}
          </h3>
          <ul className="col" style={gap(10)}>
            {errors.map((e, i) => (
              <Issue key={`${e.code}-${e.path ?? ""}-${i}`} issue={e} kind="error" />
            ))}
          </ul>
        </section>
      ) : null}
      {warnings.length ? (
        <section className="col" style={gap(10)} aria-labelledby="val-warns">
          <h3 className="h4" id="val-warns">
            {warnings.length === 1 ? "1 aviso" : `${warnings.length} avisos`}
          </h3>
          <p className="small muted">Avisos não bloqueiam o envio, mas o revisor vai ver todos. Corrigir agora acelera a aprovação.</p>
          <ul className="col" style={gap(10)}>
            {warnings.map((w, i) => (
              <Issue key={`${w.code}-${w.path ?? ""}-${i}`} issue={w} kind="warning" />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Issue({ issue, kind }: { issue: ValidationReport["errors"][number]; kind: "error" | "warning" }) {
  return (
    <li className={[s.issue, kind === "error" ? s.issueErr : s.issueWarn].join(" ")}>
      <div className="row wrapx" style={gap(8)}>
        <span className={kind === "error" ? "bad" : "warn"} aria-hidden>
          <Icon name="warning" size="s" />
        </span>
        <span className={s.code}>{issue.code}</span>
        {issue.path ? (
          <span className={s.path}>
            <span className="sr-only" style={srOnly}>
              no arquivo{" "}
            </span>
            {issue.path}
          </span>
        ) : null}
      </div>
      <span className={s.untrusted}>{issue.message}</span>
      {issue.fix ? (
        <span className="small">
          <b>Como corrigir:</b> <span className={s.untrusted}>{issue.fix}</span>
        </span>
      ) : null}
    </li>
  );
}

"use client";
// Detalhe de um envio (/creator/submissions/[id]): linha do tempo, erros do validador, recado do revisor e a ação que falta
// (reenviar corrigido, co-assinar o registro ou a atualização, esperar, ver o especialista no ar).
import type { SubmissionView } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/ui/AuthGate";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Notice } from "@/components/ui/Toast";
import { Untrusted } from "@/components/ui/Untrusted";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { canResubmit, fileSizeText, loadErrorText, statusInfo, type Tone } from "@/lib/submissions-ui";
import { CreatorHead } from "./CreatorHead";
import { CoSign } from "./CoSign";
import { StatusChip, Timeline, ValidationList } from "./SubmissionParts";
import { ZipUploader } from "./ZipUploader";
import s from "./creator.module.css";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ok"; sub: SubmissionView };

const MOVING = new Set(["submitted", "validating", "publishing"]);
const NOTICE_TONE: Record<Tone, "ok" | "warn" | "bad" | "brand" | "info"> = { ok: "ok", warn: "warn", bad: "bad", brand: "brand", plain: "info" };

export function SubmissionDetailView({ id }: { id: string }) {
  const { api, status, me } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ kind: "loading" });
      try {
        setState({ kind: "ok", sub: await api.getMySubmission(id) });
      } catch (e) {
        if (silent) return;
        if (e instanceof ApiError && e.status === 404) setState({ kind: "missing" });
        else setState({ kind: "error", message: loadErrorText(e) });
      }
    },
    [api, id],
  );

  useEffect(() => {
    if (status === "authed") void load();
  }, [status, me?.wallet, load]);

  // Estados que andam sozinhos: confere de tempos em tempos (a cada 6 s; 20 s esperando a aprovação final).
  const watch = state.kind === "ok" ? (MOVING.has(state.sub.status) ? 6000 : state.sub.status === "awaiting_onchain_approval" ? 20000 : 0) : 0;
  useEffect(() => {
    if (!watch) return;
    timer.current = setTimeout(() => void load(true), watch);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [watch, state, load]);

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="submissions" />
      <AuthGate icon="pen" title="Entre para ver este envio" text="Só quem enviou o pacote vê o andamento dele.">
        <div style={{ marginBottom: 16 }}>
          <Link className="link small" href="/creator/submissions">
            <Icon name="arrow-left" size="s" /> Todos os meus envios
          </Link>
        </div>
        {state.kind === "loading" ? <Loading text="Carregando o envio…" /> : null}
        {state.kind === "missing" ? (
          <Empty icon="search" title="Envio não encontrado" action={<Button href="/creator/submissions">Ver meus envios</Button>}>
            Este envio não existe ou não é da sua conta.
          </Empty>
        ) : null}
        {state.kind === "error" ? (
          <Empty icon="warning" title="Não deu para carregar o envio" action={<Button onClick={() => void load()}>Tentar de novo</Button>}>
            {state.message}
          </Empty>
        ) : null}
        {state.kind === "ok" ? <Detail sub={state.sub} reload={() => load(true)} /> : null}
      </AuthGate>
    </section>
  );
}

function Detail({ sub, reload }: { sub: SubmissionView; reload: () => Promise<void> }) {
  const router = useRouter();
  const info = statusInfo(sub.status, sub.nextAction);
  const errors = sub.validation?.errors.length ?? 0;
  const published = sub.status === "published";

  return (
    <div className="split">
      <div className="col" style={gap(24)}>
        <div className="col" style={gap(10)}>
          <div className="row wrapx" style={gap(10)}>
            <span className="eyebrow">Envio</span>
            <StatusChip status={sub.status} nextAction={sub.nextAction} />
          </div>
          <h1 className="display h2s" style={{ overflowWrap: "anywhere" }}>
            <Untrusted>{sub.name || sub.slug}</Untrusted>
          </h1>
          <p className="small muted">
            <span className="mono" style={{ overflowWrap: "anywhere" }}>{sub.slug}</span> · versão {sub.version} · {fileSizeText(sub.sizeBytes)} · enviado <Ago iso={sub.createdAt} /> · atualizado <Ago iso={sub.updatedAt} />
          </p>
        </div>

        <Notice tone={NOTICE_TONE[info.tone]} title={info.label} role="status">
          {info.text}
        </Notice>

        {sub.reviewerNotes ? (
          <div className="card pad-s col" style={gap(8)}>
            <h2 className="h4">
              {sub.status === "rejected" ? "Motivo da recusa" : sub.status === "changes_requested" ? "O que a equipe pediu" : "Recado da equipe"}
            </h2>
            {/* Texto do revisor, exibido como texto (nunca como HTML). */}
            <p className={s.untrusted} style={{ whiteSpace: "pre-wrap" }}>
              <Untrusted>{sub.reviewerNotes}</Untrusted>
            </p>
          </div>
        ) : null}

        {sub.error ? (
          <Notice tone="warn" title="Houve um problema técnico" role="status">
            <span className={s.untrusted}><Untrusted>{sub.error}</Untrusted></span>
          </Notice>
        ) : null}

        {sub.nextAction === "sign_register" || sub.nextAction === "sign_update" ? <CoSign sub={sub} onDone={reload} /> : null}

        {published ? (
          <div className="card pad row between wrapx" style={gap(12, { borderColor: "var(--mint)" })}>
            <span className="row" style={gap(12)}>
              <span className="dot dot-ok">
                <Icon name="check" />
              </span>
              <span className="col" style={gap(0)}>
                <b>O especialista está na vitrine</b>
                <span className="small muted">Compradores já podem encontrar e usar esta versão.</span>
              </span>
            </span>
            <Button href={`/solvers/${encodeURIComponent(sub.slug)}`} iconRight="arrow-right">
              Ver o especialista
            </Button>
          </div>
        ) : null}

        <section className="card pad col" style={gap(16)} aria-labelledby="val-title">
          <div className="row between wrapx" style={gap(10)}>
            <h2 className="h3" id="val-title">
              Conferência automática
            </h2>
            {sub.validation ? (
              <span className={errors ? "chip chip-red" : "chip chip-ok"}>{errors ? `${errors} ${errors === 1 ? "erro" : "erros"}` : "Sem erros"}</span>
            ) : null}
          </div>
          {sub.validation ? (
            <ValidationList report={sub.validation} />
          ) : (
            <p className="small muted">{sub.status === "submitted" || sub.status === "validating" ? "O resultado aparece aqui assim que a conferência terminar." : "Este envio ainda não tem resultado de conferência."}</p>
          )}
        </section>

        {canResubmit(sub) ? (
          <div className="card pad col" style={gap(16)}>
            <div className="col" style={gap(4)}>
              <h2 className="h3">{sub.status === "changes_requested" ? "Enviar o pacote corrigido" : "Enviar de novo"}</h2>
              <p className="small muted">
                {sub.status === "changes_requested"
                  ? "O pacote corrigido entra na mesma versão e volta para a conferência automática."
                  : "Corrija os erros abaixo, gere o ZIP de novo e envie. Se a versão já existir, aumente o número no manifest.json."}
              </p>
            </div>
            <ZipUploader
              resubmit={sub.status === "changes_requested" ? sub.id : undefined}
              action="Enviar pacote corrigido"
              onDone={(newId) => (newId === sub.id ? void reload() : router.push(`/creator/submissions/${encodeURIComponent(newId)}`))}
            />
          </div>
        ) : null}
      </div>

      <aside className="sticky col" style={gap(16)} aria-label="Andamento">
        <div className="card pad col" style={gap(18)}>
          <h2 className="h3">Andamento</h2>
          <Timeline status={sub.status} nextAction={sub.nextAction} />
        </div>
        <div className="card-flat pad-s small muted">Prazo: nossa meta é responder em até 5 dias úteis depois que o pacote passar na conferência automática.</div>
      </aside>
    </div>
  );
}

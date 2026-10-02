"use client";
// Lista de envios do criador (/criador/envios): cada pacote enviado, em que ponto está e o que falta.
import type { SubmissionView } from "@solvers/api-client";
import Link from "next/link";
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
import { fileSizeText, loadErrorText, REVIEW_SLA_TEXT, statusInfo } from "@/lib/submissions-ui";
import { CreatorHead } from "./CreatorHead";
import { StatusChip } from "./SubmissionParts";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: SubmissionView[] };

/** Estados que mudam sozinhos em poucos segundos: a lista se atualiza enquanto algum envio estiver neles. */
const MOVING = new Set(["submitted", "validating", "publishing"]);

const ACTION_TEXT: Partial<Record<SubmissionView["nextAction"], string>> = {
  fix_and_resubmit: "Corrigir e enviar de novo",
  sign_register: "Confirmar o cadastro",
  sign_update: "Confirmar a atualização",
};

export function SubmissionsView() {
  const { api, status, me } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ kind: "loading" });
      try {
        const items = await api.listMySubmissions();
        setState({ kind: "ok", items });
      } catch (e) {
        if (!silent) setState({ kind: "error", message: loadErrorText(e) });
      }
    },
    [api],
  );

  useEffect(() => {
    if (status === "authed") void load();
  }, [status, me?.wallet, load]);

  const moving = state.kind === "ok" && state.items.some((i) => MOVING.has(i.status));
  useEffect(() => {
    if (!moving) return;
    timer.current = setTimeout(() => void load(true), 6000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [moving, state, load]);

  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <CreatorHead tab="submissions" />
      <AuthGate icon="pen" title="Entre para ver os seus envios" text="Aqui você acompanha cada pacote enviado: conferência, revisão e publicação.">
        {state.kind === "loading" ? <Loading text="Carregando os seus envios…" /> : null}
        {state.kind === "error" ? (
          <Empty icon="warning" title="Não deu para carregar os envios" action={<Button onClick={() => void load()}>Tentar de novo</Button>}>
            {state.message}
          </Empty>
        ) : null}
        {state.kind === "ok" ? <List items={state.items} /> : null}
      </AuthGate>
    </section>
  );
}

function List({ items }: { items: SubmissionView[] }) {
  if (items.length === 0)
    return (
      <Empty icon="upload" title="Você ainda não enviou nenhum pacote" action={<Button href="/criador/publicar" iconRight="arrow-right">Publicar especialista</Button>}>
        Monte o pacote com o Criador de Solvers e envie o ZIP. O andamento aparece aqui.
      </Empty>
    );
  return (
    <div className="col" style={gap(20)}>
      <Notice tone="brand" icon="clock" role="note">
        {REVIEW_SLA_TEXT} Você recebe um aviso quando a equipe responder.
      </Notice>
      <div className="card pad-s" style={{ padding: "8px 24px" }}>
        <div className="row between wrapx" style={{ padding: "14px 0" }}>
          <h2 className="h3">Seus envios</h2>
          <Button variant="secondary" href="/criador/publicar" icon="plus">
            Enviar novo pacote
          </Button>
        </div>
        <ul>
          {items.map((it) => {
            const info = statusInfo(it.status, it.nextAction);
            const act = ACTION_TEXT[it.nextAction];
            const errors = it.validation?.errors.length ?? 0;
            return (
              <li key={it.id} className="rowline start" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="grow col" style={gap(6, { minWidth: 220 })}>
                  <div className="row wrapx" style={gap(10)}>
                    <Link className="bold" href={`/criador/envios/${encodeURIComponent(it.id)}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      <Untrusted>{it.name || it.slug}</Untrusted>
                    </Link>
                    <span className="tiny faint">v{it.version}</span>
                    <StatusChip status={it.status} nextAction={it.nextAction} />
                  </div>
                  <span className="small muted">{info.text}</span>
                  <span className="tiny faint">
                    Enviado <Ago iso={it.createdAt} /> · atualizado <Ago iso={it.updatedAt} /> · {fileSizeText(it.sizeBytes)}
                    {errors ? ` · ${errors} ${errors === 1 ? "erro" : "erros"}` : ""}
                  </span>
                </div>
                <Button variant={act ? "primary" : "secondary"} size="sm" href={`/criador/envios/${encodeURIComponent(it.id)}`} iconRight="arrow-right" aria-label={`${act ?? "Ver detalhes"}: $<Untrusted>{it.name || it.slug}</Untrusted>`}>
                  {act ?? "Ver detalhes"}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="small muted">
        <Icon name="info" size="s" /> Quer um especialista novo ou uma nova versão? Cada envio passa pelas mesmas etapas.
      </p>
    </div>
  );
}

"use client";
// Fila de revisão (/admin/revisoes). Todo texto que vem do criador (nome, slug) entra como texto escapado, sem links.
import type { AdminSubmissionRow, SubmissionStatus } from "@solvers/api-client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusChip } from "@/components/creator/SubmissionParts";
import creator from "@/components/creator/creator.module.css";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Untrusted, untrusted } from "@/components/ui/Untrusted";
import { Loading } from "@/components/ui/Spinner";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { loadErrorText } from "@/lib/submissions-ui";
import { AdminGate } from "./AdminGate";

const FILTERS: { id: SubmissionStatus | "all"; label: string }[] = [
  { id: "pending_review", label: "Na fila" },
  { id: "awaiting_onchain_approval", label: "Aprovação final" },
  { id: "publish_failed", label: "Publicação travada" },
  { id: "awaiting_creator_signature", label: "Esperando o criador" },
  { id: "changes_requested", label: "Mudanças pedidas" },
  { id: "published", label: "Publicados" },
  { id: "all", label: "Todos" },
];

/** Dias úteis (seg a sex) desde `iso`, para o prazo de 5 dias úteis da PACKAGE_SPEC.md 14.5. */
export function businessDaysSince(iso: string, now = Date.now()): number {
  const start = new Date(iso);
  let n = 0;
  for (const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; items: AdminSubmissionRow[] };

export function ReviewQueueView() {
  return (
    <AdminGate>
      <Queue />
    </AdminGate>
  );
}

function Queue() {
  const { api } = useSession();
  const [filter, setFilter] = useState<SubmissionStatus | "all">("pending_review");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const items = await api.adminListSubmissions(filter === "all" ? undefined : filter);
      setState({ kind: "ok", items });
    } catch (e) {
      setState({ kind: "error", message: loadErrorText(e) });
    }
  }, [api, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="col" style={gap(24)}>
      <div className="col" style={gap(8)}>
        <span className="eyebrow">Equipe</span>
        <h1 className="display h1s">Revisões</h1>
        <p className="muted" style={{ maxWidth: 640 }}>
          Pacotes enviados por criadores. Todo conteúdo aparece como texto puro: nada do pacote é executado nem aberto como página.
        </p>
      </div>

      <div className="row wrapx" style={gap(8)} role="group" aria-label="Filtrar por estado">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={["chip", filter === f.id ? "on" : ""].join(" ")} style={{ minHeight: 44 }} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {state.kind === "loading" ? <Loading text="Carregando a fila…" /> : null}
      {state.kind === "error" ? (
        <Empty icon="warning" title="Não deu para carregar a fila" action={<Button onClick={() => void load()}>Tentar de novo</Button>}>
          {state.message}
        </Empty>
      ) : null}
      {state.kind === "ok" && state.items.length === 0 ? (
        <Empty icon="check-circle" title="Nada por aqui">
          Nenhum envio neste estado.
        </Empty>
      ) : null}
      {state.kind === "ok" && state.items.length > 0 ? (
        <div className="card pad-s" style={{ padding: "8px 24px" }}>
          <ul>
            {state.items.map((r) => {
              const days = r.status === "pending_review" ? businessDaysSince(r.createdAt) : null;
              return (
                <li key={r.id} className={creator.queueRow}>
                  <div className="col" style={gap(4, { minWidth: 0 })}>
                    <Link href={`/admin/revisoes/${encodeURIComponent(r.id)}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      <Untrusted>{r.name || r.slug}</Untrusted>
                    </Link>
                    <span className="tiny faint" style={{ overflowWrap: "anywhere" }}>
                      <Untrusted>{r.slug}</Untrusted> · v{r.version}
                    </span>
                    <span className="row wrapx" style={gap(6)}>
                      <Chip tone={r.isNewAgent ? "brand" : "default"}>{r.isNewAgent ? "Especialista novo" : "Nova versão"}</Chip>
                      {r.errors ? <Chip tone="red">{r.errors} {r.errors === 1 ? "erro" : "erros"}</Chip> : null}
                      {r.warnings ? <Chip tone="warn">{r.warnings} {r.warnings === 1 ? "aviso" : "avisos"}</Chip> : null}
                    </span>
                  </div>
                  <div className="col" style={gap(2, { minWidth: 0 })}>
                    <span className="small" style={{ overflowWrap: "anywhere" }}>
                      <Untrusted>{r.creatorName || "Sem nome"}</Untrusted>
                    </span>
                    <span className="tiny faint mono" style={{ overflowWrap: "anywhere" }}>
                      {r.creatorWallet}
                    </span>
                  </div>
                  <div className="col" style={gap(4)}>
                    <span>
                      <StatusChip status={r.status} />
                    </span>
                    <span className="tiny faint">
                      Enviado <Ago iso={r.createdAt} />
                    </span>
                    {days !== null ? (
                      <span className={days >= 5 ? "tiny warn" : "tiny faint"}>
                        {days >= 5 ? "Passou da meta de 5 dias úteis" : `${days} de 5 dias úteis`}
                      </span>
                    ) : null}
                  </div>
                  <Button variant="secondary" size="sm" href={`/admin/revisoes/${encodeURIComponent(r.id)}`} iconRight="arrow-right" aria-label={`Revisar ${untrusted(r.name || r.slug)}`}>
                    Revisar
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

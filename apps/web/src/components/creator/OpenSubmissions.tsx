"use client";
// Cartão do painel do criador (/criador): envios em andamento. Some sozinho se não há nenhum ou se a lista não carrega
// (o painel continua útil sem ele).
import { SUBMISSION_OPEN_STATUSES, type SubmissionView } from "@solvers/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Ago } from "@/components/ui/Ago";
import { Button } from "@/components/ui/Button";
import { Untrusted } from "@/components/ui/Untrusted";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { statusInfo } from "@/lib/submissions-ui";
import { StatusChip } from "./SubmissionParts";

const SHOWN = 3;

export function OpenSubmissions() {
  const { api, me } = useSession();
  const [items, setItems] = useState<SubmissionView[] | null>(null);

  useEffect(() => {
    let live = true;
    api.listMySubmissions().then(
      (r) => live && setItems(r.filter((i) => SUBMISSION_OPEN_STATUSES.includes(i.status))),
      () => live && setItems(null),
    );
    return () => {
      live = false;
    };
  }, [api, me?.wallet]);

  if (!items || items.length === 0) return null;
  return (
    <section className="card pad-s" style={{ padding: "8px 24px", marginBottom: 24 }} aria-labelledby="open-subs">
      <div className="row between wrapx" style={{ padding: "14px 0" }}>
        <h2 className="h3" id="open-subs">
          Envios em andamento
        </h2>
        <Button variant="secondary" href="/criador/envios">
          Ver todos os envios
        </Button>
      </div>
      <ul style={{ borderTop: "1px solid var(--line)" }}>
        {items.slice(0, SHOWN).map((it) => (
          <li key={it.id} className="rowline start" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <div className="grow col" style={gap(4, { minWidth: 200 })}>
              <div className="row wrapx" style={gap(10)}>
                <Link href={`/criador/envios/${encodeURIComponent(it.id)}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                  <Untrusted>{it.name || it.slug}</Untrusted>
                </Link>
                <span className="tiny faint">v{it.version}</span>
                <StatusChip status={it.status} nextAction={it.nextAction} />
              </div>
              <span className="small muted">{statusInfo(it.status, it.nextAction).text}</span>
              <span className="tiny faint">
                Atualizado <Ago iso={it.updatedAt} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {items.length > SHOWN ? <p className="small muted" style={{ padding: "0 0 14px" }}>E mais {items.length - SHOWN} em andamento.</p> : null}
    </section>
  );
}

"use client";
// Aba "Especialistas" da biblioteca: licenças permanentes, com o uso das últimas 8 semanas.
import type { MyTrial, UsageSummary } from "@solvers/api-client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { ReviewBox } from "@/components/catalog/ReviewBox";
import { Tile } from "@/components/ui/Tile";
import { date, int, spark } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLibrary } from "./LibraryShell";
import { useAgentsIndex } from "@/lib/hooks";
import { LoadError } from "./shared";
import { TrialsSection } from "./TrialsSection";

export function Licenses() {
  const { licenses, reloadLicenses } = useLibrary();
  const { api } = useSession();
  const [usage, setUsage] = useState<Map<string, UsageSummary>>(new Map());
  // Testes grátis em andamento; se a chamada falhar a lista de licenças continua valendo sozinha.
  const [trials, setTrials] = useState<MyTrial[] | null>(null);
  // Licença com o formulário de avaliação aberto.
  const [reviewing, setReviewing] = useState<string | null>(null);
  const list = Array.isArray(licenses) ? licenses : [];
  const agents = useAgentsIndex([...list.map((l) => l.agentId), ...(trials ?? []).map((t) => t.agentId)]);

  useEffect(() => {
    api.getMyUsage().then((u) => setUsage(new Map(u.map((x) => [x.agentId, x]))), () => {});
    api.getMyTrials().then(setTrials, () => setTrials([]));
  }, [api]);

  if (licenses === "error") return <LoadError onRetry={reloadLicenses} text="Não conseguimos carregar suas licenças agora." />;
  if (licenses === null || trials === null) return <Loading text="Carregando seus especialistas…" />;
  if (!list.length && !trials.length)
    return (
      <Empty icon="library" title="Nenhum especialista na sua biblioteca" action={<Button href="/">Explorar especialistas</Button>}>
        Quando você comprar a licença de um especialista, ele aparece aqui com o uso de cada mês. Os testes grátis que você começar também.
      </Empty>
    );

  return (
    <div className="col" style={{ "--gap": "18px" } as React.CSSProperties}>
      {trials.length ? <TrialsSection trials={trials} agents={agents} /> : null}
      {trials.length && list.length ? <h2 className="h4">Licenças</h2> : null}
      {list.map((l) => {
        const a = agents.get(l.agentId);
        const u = usage.get(l.agentId);
        const weekly = u?.weekly ?? [0, 0, 0, 0, 0, 0, 0, 0];
        const uses = u?.usesThisMonth ?? 0;
        return (
          <article key={l.id} className="card" style={{ padding: 0 }}>
            <div className="lib-row" style={{ padding: "22px 24px" }}>
              <div className="row" style={{ "--gap": "16px", minWidth: 0 } as React.CSSProperties}>
                {a ? <Tile category={a.category} /> : <span className="tile" aria-hidden />}
                <div className="grow">
                  <h2 className="h4 trunc">{a?.name ?? "Especialista"}</h2>
                  <div className="row wrapx" style={{ "--gap": "6px 8px", marginTop: 4 } as React.CSSProperties}>
                    <Chip tone="brand">Licença permanente</Chip>
                    <span className="tiny faint">desde {date(l.acquiredAt)}</span>
                  </div>
                </div>
              </div>
              <div className="col" style={{ "--gap": "6px" } as React.CSSProperties}>
                <span className="small muted">Uso nas últimas 8 semanas</span>
                <div className="row" style={{ "--gap": "14px" } as React.CSSProperties}>
                  <svg className="spark" width="96" height="30" viewBox="0 0 96 30" aria-hidden>
                    <path
                      d={spark(weekly.map((x) => x + 0.001), 96, 30)}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: "var(--brand)" }}
                    />
                  </svg>
                  <b className="num">{uses === 1 ? "1 uso este mês" : `${int(uses)} usos este mês`}</b>
                </div>
              </div>
              <div className="col" style={{ "--gap": "6px" } as React.CSSProperties}>
                <span className="small muted">Uso</span>
                <b className="ok row" style={{ "--gap": "6px" } as React.CSSProperties}>
                  <Icon name="check-circle" size="s" />
                  Uso ilimitado
                </b>
              </div>
              <div className="row wrapx" style={{ "--gap": "8px", justifyContent: "flex-end" } as React.CSSProperties}>
                {a ? (
                  <>
                    <Button variant="secondary" href={`/instalar?agent=${encodeURIComponent(a.slug)}`}>
                      Abrir instalação
                    </Button>
                    <Button variant="ghost" icon="star" aria-expanded={reviewing === l.id} onClick={() => setReviewing(reviewing === l.id ? null : l.id)}>
                      Avaliar
                    </Button>
                    <Button variant="ghost" href={`/especialistas/${encodeURIComponent(a.slug)}`}>
                      Ver especialista
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {a && reviewing === l.id ? (
              <div style={{ padding: "4px 24px 24px", borderTop: "1px solid var(--line)", paddingTop: 20 }}>
                <ReviewBox compact agentId={l.agentId} slug={a.slug} onSaved={() => setReviewing(null)} onCancel={() => setReviewing(null)} />
              </div>
            ) : null}
          </article>
        );
      })}
      <p className="small faint row" style={{ "--gap": "8px", marginTop: 4 } as React.CSSProperties}>
        <Icon name="tag" size="s" />
        Revenda de licenças em breve.
      </p>
    </div>
  );
}

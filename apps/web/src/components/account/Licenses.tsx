"use client";
// Aba "Especialistas" da biblioteca: licenças permanentes, com o uso das últimas 8 semanas.
import type { License, MyTrial, UsageSummary } from "@solvers/api-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { ReviewBox } from "@/components/catalog/ReviewBox";
import { ListLicenseDialog } from "@/components/resale/ListLicenseDialog";
import { TxErrorNotice } from "@/components/resale/TxErrorNotice";
import { Tile } from "@/components/ui/Tile";
import { useToast } from "@/components/ui/Toast";
import { brl, date, int, spark, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTx } from "@/lib/tx";
import { useLibrary } from "./LibraryShell";
import { useAgentsIndex } from "@/lib/hooks";
import { LoadError } from "./shared";
import { TrialsSection } from "./TrialsSection";

export function Licenses() {
  const { licenses, reloadLicenses } = useLibrary();
  const { api, config } = useSession();
  const toast = useToast();
  // Revenda: só com a flag ligada. Anunciar abre o diálogo; cancelar assina direto (um de cada vez).
  const resaleOn = !!config?.resaleEnabled;
  const rate = config?.brlPerUsd ?? null;
  const [listing, setListing] = useState<License | null>(null);
  const cancelTx = useTx();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelFailed, setCancelFailed] = useState<string | null>(null);
  const [usage, setUsage] = useState<Map<string, UsageSummary>>(new Map());
  // Testes grátis em andamento; se a chamada falhar a lista de licenças continua valendo sozinha.
  const [trials, setTrials] = useState<MyTrial[] | null>(null);
  // Licença com o formulário de avaliação aberto.
  const [reviewing, setReviewing] = useState<string | null>(null);
  const list = Array.isArray(licenses) ? licenses : [];
  const agents = useAgentsIndex([...list.map((l) => l.agentId), ...(trials ?? []).map((t) => t.agentId)]);
  // Anunciar ou cancelar recarrega a lista e o botão clicado some: o foco vai para a lista (que continua na tela).
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const reloadAndFocus = () => {
    refocus.current = true;
    reloadLicenses();
  };
  useEffect(() => {
    if (!refocus.current || !Array.isArray(licenses)) return;
    refocus.current = false;
    listRef.current?.focus();
  }, [licenses]);
  const listingAgent = listing ? agents.get(listing.agentId) : undefined;

  useEffect(() => {
    api.getMyUsage().then((u) => setUsage(new Map(u.map((x) => [x.agentId, x]))), () => {});
    api.getMyTrials().then(setTrials, () => setTrials([]));
  }, [api]);

  async function cancelListing(l: License) {
    setCancelling(l.id);
    setCancelFailed(null);
    const r = await cancelTx.run(() => api.buildCancelListing(l.id));
    setCancelling(null);
    if (!r) {
      setCancelFailed(l.id);
      return;
    }
    toast({ tone: "ok", title: "Anúncio cancelado", text: "A licença saiu do mercado e continua sua." });
    reloadAndFocus();
  }

  if (licenses === "error") return <LoadError onRetry={reloadLicenses} text="Não conseguimos carregar suas licenças agora." />;
  if (licenses === null || trials === null) return <Loading text="Carregando seus especialistas…" />;
  if (!list.length && !trials.length)
    return (
      <Empty icon="library" title="Nenhum especialista na sua biblioteca" action={<Button href="/">Explorar especialistas</Button>}>
        Quando você comprar a licença de um especialista, ele aparece aqui com o uso de cada mês. Os testes grátis que você começar também.
      </Empty>
    );

  return (
    <div ref={listRef} tabIndex={-1} role="region" aria-label="Suas licenças" className="col" style={{ "--gap": "18px", outline: "none" } as React.CSSProperties}>
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
                    {resaleOn && l.listedForResale ? (
                      <Chip tone="ok" icon="tag">
                        À venda{l.resalePriceUsdc != null ? ` por ${rate != null ? brl(l.resalePriceUsdc, rate) : usdc(l.resalePriceUsdc)}` : ""}
                      </Chip>
                    ) : null}
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
              <div className="row wrapx" style={{ "--gap": "8px", justifyContent: "flex-end", ...(resaleOn ? { maxWidth: 340 } : {}) } as React.CSSProperties}>
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
                    {resaleOn ? (
                      l.listedForResale ? (
                        <Button variant="secondary" loading={cancelling === l.id} disabled={cancelling != null} onClick={() => void cancelListing(l)}>
                          Cancelar anúncio
                        </Button>
                      ) : (
                        <Button variant="secondary" icon="tag" onClick={() => setListing(l)}>
                          Anunciar
                        </Button>
                      )
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            {resaleOn && l.listedForResale ? (
              <p className="tiny faint row" style={{ "--gap": "8px", padding: "0 24px 16px", marginTop: -8 } as React.CSSProperties}>
                <Icon name="info" size="s" />
                Você continua usando o especialista até alguém comprar.
              </p>
            ) : null}
            {resaleOn && cancelFailed === l.id && cancelTx.error ? (
              <div style={{ padding: "0 24px 20px" }}>
                <TxErrorNotice error={cancelTx.error} onRetry={() => void cancelListing(l)} />
              </div>
            ) : null}
            {a && reviewing === l.id ? (
              <div style={{ padding: "4px 24px 24px", borderTop: "1px solid var(--line)", paddingTop: 20 }}>
                <ReviewBox compact agentId={l.agentId} slug={a.slug} onSaved={() => setReviewing(null)} onCancel={() => setReviewing(null)} />
              </div>
            ) : null}
          </article>
        );
      })}
      {resaleOn ? null : (
        <p className="small faint row" style={{ "--gap": "8px", marginTop: 4 } as React.CSSProperties}>
          <Icon name="tag" size="s" />
          Revenda de licenças em breve.
        </p>
      )}
      {resaleOn && listing && listingAgent ? (
        <ListLicenseDialog license={listing} agent={listingAgent} onClose={() => setListing(null)} onListed={reloadAndFocus} />
      ) : null}
    </div>
  );
}

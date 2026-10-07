"use client";
// Aba "Especialistas" da biblioteca: licenças permanentes, com o uso das últimas 8 semanas.
import type { License, MyTrial, UsageSummary } from "@solvers/api-client";
import { useTranslations } from "next-intl";
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
import { spark, useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTx } from "@/lib/tx";
import { useLibrary } from "./LibraryShell";
import { useAgentsIndex } from "@/lib/hooks";
import { LoadError } from "./shared";
import { TrialsSection } from "./TrialsSection";

export function Licenses() {
  const { licenses, reloadLicenses } = useLibrary();
  const { api, config } = useSession();
  const t = useTranslations("account");
  const f = useFormat();
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
  const agents = useAgentsIndex([...list.map((l) => l.agentId), ...(trials ?? []).map((tr) => tr.agentId)]);
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
    toast({ tone: "ok", title: t("licenses.cancelledTitle"), text: t("licenses.cancelledText") });
    reloadAndFocus();
  }

  if (licenses === "error") return <LoadError onRetry={reloadLicenses} text={t("licenses.loadError")} />;
  if (licenses === null || trials === null) return <Loading text={t("licenses.loading")} />;
  if (!list.length && !trials.length)
    return (
      <Empty icon="library" title={t("licenses.emptyTitle")} action={<Button href="/">{t("licenses.explore")}</Button>}>
        {t("licenses.emptyText")}
      </Empty>
    );

  return (
    <div ref={listRef} tabIndex={-1} role="region" aria-label={t("licenses.region")} className="col" style={{ "--gap": "18px", outline: "none" } as React.CSSProperties}>
      {trials.length ? <TrialsSection trials={trials} agents={agents} /> : null}
      {trials.length && list.length ? <h2 className="h4">{t("licenses.heading")}</h2> : null}
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
                  <h2 className="h4 trunc">{a?.name ?? t("shared.unnamedSolver")}</h2>
                  <div className="row wrapx" style={{ "--gap": "6px 8px", marginTop: 4 } as React.CSSProperties}>
                    <Chip tone="brand">{t("licenses.permanent")}</Chip>
                    {resaleOn && l.listedForResale ? (
                      <Chip tone="ok" icon="tag">
                        {l.resalePriceUsdc != null
                          ? t("licenses.forSaleFor", { price: rate != null ? f.brl(l.resalePriceUsdc, rate) : f.usdc(l.resalePriceUsdc) })
                          : t("licenses.forSale")}
                      </Chip>
                    ) : null}
                    <span className="tiny faint">{t("licenses.since", { date: f.date(l.acquiredAt) })}</span>
                  </div>
                </div>
              </div>
              <div className="col" style={{ "--gap": "6px" } as React.CSSProperties}>
                <span className="small muted">{t("licenses.usage8w")}</span>
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
                  <b className="num">{t("licenses.usesMonth", { n: uses })}</b>
                </div>
              </div>
              <div className="col" style={{ "--gap": "6px" } as React.CSSProperties}>
                <span className="small muted">{t("licenses.usage")}</span>
                <b className="ok row" style={{ "--gap": "6px" } as React.CSSProperties}>
                  <Icon name="check-circle" size="s" />
                  {t("licenses.unlimited")}
                </b>
              </div>
              <div className="row wrapx" style={{ "--gap": "8px", justifyContent: "flex-end", ...(resaleOn ? { maxWidth: 340 } : {}) } as React.CSSProperties}>
                {a ? (
                  <>
                    <Button variant="secondary" href={`/install?agent=${encodeURIComponent(a.slug)}`}>
                      {t("licenses.openInstall")}
                    </Button>
                    <Button variant="ghost" icon="star" aria-expanded={reviewing === l.id} onClick={() => setReviewing(reviewing === l.id ? null : l.id)}>
                      {t("licenses.review")}
                    </Button>
                    <Button variant="ghost" href={`/solvers/${encodeURIComponent(a.slug)}`}>
                      {t("licenses.viewSolver")}
                    </Button>
                    {resaleOn ? (
                      l.listedForResale ? (
                        <Button variant="secondary" loading={cancelling === l.id} disabled={cancelling != null} onClick={() => void cancelListing(l)}>
                          {t("licenses.cancelListing")}
                        </Button>
                      ) : (
                        <Button variant="secondary" icon="tag" onClick={() => setListing(l)}>
                          {t("licenses.list")}
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
                {t("licenses.listedNote")}
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
          {t("licenses.resaleSoon")}
        </p>
      )}
      {resaleOn && listing && listingAgent ? (
        <ListLicenseDialog license={listing} agent={listingAgent} onClose={() => setListing(null)} onListed={reloadAndFocus} />
      ) : null}
    </div>
  );
}

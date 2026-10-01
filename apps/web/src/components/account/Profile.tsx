"use client";
// /perfil (perfil-e-reputacao.html, aba do usuário): nome editável, reputação, limite de garantia,
// histórico real (com link do explorer) e detalhes técnicos.
import type { GuaranteeStatus, Profile as ProfileData } from "@solvers/api-client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Chip, RepBadge } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { TechCard } from "@/components/ui/TechCard";
import { useToast } from "@/components/ui/Toast";
import { clusterName, explorerTx, explorerWallet } from "@/lib/explorer";
import { ago, date, GUARANTEE_LEVEL_LABEL, initials, REP_LEVELS, repLevel, short, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { txErrorMessage } from "@/lib/tx";
import { AuthGate } from "@/components/ui/AuthGate";
import { LoadError } from "./shared";

const HISTORY_MARK: Record<string, { dot: string; mark: string }> = {
  purchase: { dot: "dot-ok", mark: "✓" },
  review: { dot: "dot-now", mark: "★" },
  escrow: { dot: "dot-now", mark: "⛨" },
  milestone: { dot: "dot-ok", mark: "✓" },
  dispute_resolved: { dot: "", mark: "↩" },
};

function NameEditor({ current, onSaved }: { current: string | null; onSaved: (name: string) => void }) {
  const { api, refresh } = useSession();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name) return setErr("Escreva um nome.");
    setBusy(true);
    setErr(null);
    try {
      await api.updateProfile({ displayName: name });
      onSaved(name);
      setEditing(false);
      void refresh(); // atualiza o nome no cabeçalho
    } catch (e2) {
      setErr(txErrorMessage(e2).text);
    } finally {
      setBusy(false);
    }
  };

  if (!editing)
    return (
      <button
        type="button"
        className="link-btn small"
        style={{ minHeight: 32 }}
        onClick={() => {
          setValue(current ?? "");
          setEditing(true);
        }}
      >
        <Icon name="pen" size="s" />
        {current ? "Editar nome" : "Adicionar seu nome"}
      </button>
    );
  return (
    <form className="col" style={{ "--gap": "8px", width: "100%", maxWidth: 420 } as React.CSSProperties} onSubmit={save}>
      <label className="label" htmlFor="nome">
        Como quer ser chamado?
      </label>
      <div className="row wrapx" style={{ "--gap": "8px" } as React.CSSProperties}>
        <input
          id="nome"
          className="input grow"
          style={{ minWidth: 180 }}
          value={value}
          maxLength={80}
          autoFocus
          autoComplete="name"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
        <Button type="submit" loading={busy}>
          Salvar
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          Cancelar
        </Button>
      </div>
      {err ? (
        <span className="small bad" role="alert">
          {err}
        </span>
      ) : null}
    </form>
  );
}

function Inner() {
  const { api, config } = useSession();
  const [p, setP] = useState<ProfileData | null | "error">(null);
  const [g, setG] = useState<GuaranteeStatus | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setP(null);
    api.getProfile().then(setP, () => setP("error"));
    api.getMyGuarantee().then(setG, () => setG(null));
  }, [api]);
  useEffect(load, [load]);

  if (p === "error") return <LoadError onRetry={load} text="Não conseguimos carregar seu perfil agora." />;
  if (!p) return <Loading text="Carregando seu perfil…" />;

  const rep = p.reputation;
  const score = Math.round(rep.score);
  const lv = repLevel(rep.score);
  const name = p.displayName ?? short(p.wallet);
  const level = g?.level ?? rep.guaranteeLevel;
  const levelText = GUARANTEE_LEVEL_LABEL[level].toLowerCase();
  // Progresso até o nível completo: compras feitas / compras necessárias (a API diz quantas faltam).
  const toFull = g?.purchasesToFull ?? 0;
  const needed = rep.purchases + toFull;
  const pct = level === "full" ? 100 : needed ? Math.round((100 * rep.purchases) / needed) : 0;
  const tooManyDisputes = !!g && g.disputesLost > g.maxDisputesLost;
  const next =
    level === "full"
      ? "Você já tem o nível de garantia completo."
      : tooManyDisputes
        ? "Contestações perdidas demais para o nível completo."
        : toFull > 0
          ? `${toFull === 1 ? "Falta 1 compra" : `Faltam ${toFull} compras`} para o nível de garantia completo.`
          : "Continue comprando sem perder contestações para chegar ao nível completo.";

  return (
    <>
      <div className="g2 gs2" style={{ "--gap": "24px", marginBottom: 24 } as React.CSSProperties}>
        <div className="card pad-l row start m-col-x" style={{ "--gap": "28px" } as React.CSSProperties}>
          <span className="av av-l" aria-hidden>
            {p.displayName ? initials(p.displayName) : p.wallet.slice(0, 2).toUpperCase()}
          </span>
          <div className="col grow" style={{ "--gap": "8px" } as React.CSSProperties}>
            <h1 className="display h2s" style={{ overflowWrap: "anywhere" }}>
              {name}
            </h1>
            <span className="small muted">
              Membro desde {date(p.memberSince)}
              {p.email ? ` · ${p.email}` : ""}
            </span>
            <NameEditor
              current={p.displayName}
              onSaved={(n) => {
                setP({ ...p, displayName: n });
                toast({ tone: "ok", title: "Nome atualizado" });
              }}
            />
            <div className="row wrapx" style={{ "--gap": "8px", marginTop: 2 } as React.CSSProperties}>
              <RepBadge score={rep.score}>
                <span>Comprador {lv.label.toLowerCase()}</span>
              </RepBadge>
              <Chip>Garantia {levelText}</Chip>
              {p.creator ? (
                <Button variant="secondary" size="sm" icon="pen" href="/criador">
                  Painel do criador
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="score-card score-verified row" style={{ "--gap": "22px" } as React.CSSProperties}>
          <div className="ring" style={{ "--p": score } as React.CSSProperties} role="img" aria-label={`Reputação ${score} de 100`}>
            <div>
              <span className="display num" style={{ fontSize: 38 }}>
                {score}
              </span>
            </div>
          </div>
          <div className="col" style={{ "--gap": "6px" } as React.CSSProperties}>
            <b style={{ fontSize: 17 }}>Selo de confiança</b>
            <span className="small muted">{next}</span>
            <div className="bar mint" style={{ width: 180, maxWidth: "100%" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso até o nível completo">
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="g3 m1" style={{ "--gap": "16px", marginBottom: 24 } as React.CSSProperties}>
        <div className="card pad-s col" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="small muted">Compras</span>
          <span className="display num" style={{ fontSize: 48, lineHeight: 1 }}>
            {rep.purchases}
          </span>
        </div>
        <div className="card pad-s col" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="small muted">Contestações perdidas</span>
          <span className="display num" style={{ fontSize: 48, lineHeight: 1 }}>
            {rep.disputesLost}
          </span>
        </div>
        <div className="card pad-s col" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="small muted">Nível de garantia</span>
          <span className="display" style={{ fontSize: 48, lineHeight: 1 }}>
            {levelText}
          </span>
          {g ? (
            <span className="tiny faint">
              Até {usdc(g.limitUsdc)} em garantias abertas · disponível {usdc(g.availableUsdc)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="g2 gs2" style={{ "--gap": "24px", marginBottom: 24, alignItems: "start" } as React.CSSProperties}>
        <div className="card pad-s" style={{ padding: "8px 24px" }}>
          <h2 className="h3" style={{ padding: "16px 0 4px" }}>
            Histórico resumido
          </h2>
          {p.history.length ? (
            (allHistory ? p.history : p.history.slice(0, 6)).map((h, i) => {
              const m = HISTORY_MARK[h.kind] ?? { dot: "", mark: "•" };
              return (
                <div key={`${h.signature ?? i}-${h.kind}`} className="rowline">
                  <span className={`dot ${m.dot}`} style={{ width: 28, height: 28 }} aria-hidden>
                    {m.mark}
                  </span>
                  <div className="grow">
                    <b>{h.label}</b>
                    {h.signature ? (
                      <div className="small">
                        <a className="muted row" style={{ "--gap": "4px", display: "inline-flex" } as React.CSSProperties} href={explorerTx(p.explorerUrl, h.signature)} target="_blank" rel="noopener noreferrer">
                          Ver na rede <Icon name="external" size="s" />
                        </a>
                      </div>
                    ) : null}
                  </div>
                  <span className="tiny faint" title={new Date(h.at).toLocaleString("pt-BR")}>
                    {ago(h.at)}
                  </span>
                </div>
              );
            })
          ) : null}
          {p.history.length > 6 ? (
            <div className="rowline">
              <button type="button" className="link-btn small" aria-expanded={allHistory} onClick={() => setAllHistory(!allHistory)}>
                {allHistory ? "Mostrar menos" : `Ver histórico completo (${p.history.length})`}
              </button>
            </div>
          ) : null}
          {!p.history.length ? (
            <p className="muted small" style={{ padding: "12px 0 20px" }}>
              Suas compras, avaliações e garantias aparecem aqui, com o registro na rede Solana.
            </p>
          ) : null}
        </div>
        <div className="card pad col" style={{ "--gap": "14px" } as React.CSSProperties}>
          <h2 className="h3">Como sua reputação sobe</h2>
          <div className="row start" style={{ "--gap": "12px" } as React.CSSProperties}>
            <span className="ok">
              <Icon name="check-circle" size="s" />
            </span>
            <span className="small">Concluir tarefas com garantia sem disputas.</span>
          </div>
          <div className="row start" style={{ "--gap": "12px" } as React.CSSProperties}>
            <span className="ok">
              <Icon name="check-circle" size="s" />
            </span>
            <span className="small">Avaliar as compras com honestidade.</span>
          </div>
          <div className="divider" />
          <span className="small muted">Contestações perdidas descontam pontos. Contestar com critério claro e de boa fé não prejudica você.</span>
        </div>
      </div>

      <div className="card-flat" style={{ padding: "26px 28px", marginBottom: 24 }}>
        <div className="row between wrapx" style={{ "--gap": "16px" } as React.CSSProperties}>
          <div className="col" style={{ "--gap": "4px" } as React.CSSProperties}>
            <h2 className="h3">Níveis de reputação</h2>
            <span className="small muted">O selo aparece no perfil e nas garantias.</span>
          </div>
          <div className="row wrapx" style={{ "--gap": "8px" } as React.CSSProperties}>
            {REP_LEVELS.map((l) => {
              const cur = l.key === lv.key;
              return (
                <span
                  key={l.key}
                  className={["rep", l.cls].filter(Boolean).join(" ")}
                  style={cur ? { outline: "2px solid var(--brand)", outlineOffset: 2 } : { opacity: 0.75 }}
                  aria-current={cur ? "true" : undefined}
                >
                  <span>
                    {l.name} · {l.range}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <TechCard
        text="Tudo o que aparece aqui também fica registrado na rede Solana, e qualquer pessoa pode verificar."
        rows={[
          { label: "Carteira", value: p.wallet, mono: true },
          { label: "Rede", value: config ? clusterName(config.cluster) : "Solana" },
        ]}
        explorer={config ? explorerWallet(config, p.wallet) : p.explorerUrl}
      />
    </>
  );
}

export function ProfileScreen() {
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <AuthGate icon="user" title="Entre para ver seu perfil" text="Sua reputação, o limite de garantia e o histórico das suas compras ficam aqui.">
        <Inner />
      </AuthGate>
    </section>
  );
}

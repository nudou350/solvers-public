"use client";
// /perfil (perfil-e-reputacao.html, aba do usuário): nome editável, reputação, limite de garantia,
// histórico real (com link do explorer) e detalhes técnicos.
import type { GuaranteeStatus, Profile as ProfileData } from "@solvers/api-client";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Chip, RepBadge } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { TechCard } from "@/components/ui/TechCard";
import { useToast } from "@/components/ui/Toast";
import { clusterName, explorerTx, explorerWallet } from "@/lib/explorer";
import { initials, short, useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTxErrorMessage } from "@/lib/tx";
import type { Locale } from "@/i18n/routing";
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
  const t = useTranslations("account.profile");
  const errorInfo = useTxErrorMessage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name) return setErr(t("nameRequired"));
    setBusy(true);
    setErr(null);
    try {
      await api.updateProfile({ displayName: name });
      onSaved(name);
      setEditing(false);
      void refresh(); // atualiza o nome no cabeçalho
    } catch (e2) {
      setErr(errorInfo(e2).text);
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
        {current ? t("editName") : t("addName")}
      </button>
    );
  return (
    <form className="col" style={{ "--gap": "8px", width: "100%", maxWidth: 420 } as React.CSSProperties} onSubmit={save}>
      <label className="label" htmlFor="nome">
        {t("nameLabel")}
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
          {t("save")}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          {t("cancel")}
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
  const t = useTranslations("account.profile");
  const f = useFormat();
  const locale = useLocale() as Locale;
  const [p, setP] = useState<ProfileData | null | "error">(null);
  const [g, setG] = useState<GuaranteeStatus | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setP(null);
    api.getProfile(locale).then(setP, () => setP("error"));
    api.getMyGuarantee().then(setG, () => setG(null));
  }, [api, locale]);
  useEffect(load, [load]);

  if (p === "error") return <LoadError onRetry={load} text={t("loadError")} />;
  if (!p) return <Loading text={t("loading")} />;

  const rep = p.reputation;
  const score = Math.round(rep.score);
  const lv = f.repLevel(rep.score);
  const name = p.displayName ?? short(p.wallet);
  const level = g?.level ?? rep.guaranteeLevel;
  const levelText = f.guaranteeLevel(level).toLowerCase();
  // Progresso até o nível completo: compras feitas / compras necessárias (a API diz quantas faltam).
  const toFull = g?.purchasesToFull ?? 0;
  const needed = rep.purchases + toFull;
  const pct = level === "full" ? 100 : needed ? Math.round((100 * rep.purchases) / needed) : 0;
  const tooManyDisputes = !!g && g.disputesLost > g.maxDisputesLost;
  const next =
    level === "full"
      ? t("nextFull")
      : tooManyDisputes
        ? t("nextTooMany")
        : toFull > 0
          ? t("nextToFull", { n: toFull })
          : t("nextKeep");

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
              {t("memberSince", { date: f.date(p.memberSince) })}
              {p.email ? ` · ${p.email}` : ""}
            </span>
            <NameEditor
              current={p.displayName}
              onSaved={(n) => {
                setP({ ...p, displayName: n });
                toast({ tone: "ok", title: t("nameUpdated") });
              }}
            />
            <div className="row wrapx" style={{ "--gap": "8px", marginTop: 2 } as React.CSSProperties}>
              <RepBadge score={rep.score}>
                <span>{t("buyerBadge", { level: lv.label.toLowerCase() })}</span>
              </RepBadge>
              <Chip>{t("guaranteeChip", { level: levelText })}</Chip>
              {p.creator ? (
                <Button variant="secondary" size="sm" icon="pen" href="/creator">
                  {t("creatorPanel")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="score-card score-verified row" style={{ "--gap": "22px" } as React.CSSProperties}>
          <div className="ring" style={{ "--p": score } as React.CSSProperties} role="img" aria-label={t("ringLabel", { score })}>
            <div>
              <span className="display num" style={{ fontSize: 38 }}>
                {score}
              </span>
            </div>
          </div>
          <div className="col" style={{ "--gap": "6px" } as React.CSSProperties}>
            <b style={{ fontSize: 17 }}>{t("trustSeal")}</b>
            <span className="small muted">{next}</span>
            <div className="bar mint" style={{ width: 180, maxWidth: "100%" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("progressLabel")}>
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="g3 m1" style={{ "--gap": "16px", marginBottom: 24 } as React.CSSProperties}>
        <div className="card pad-s col" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="small muted">{t("purchases")}</span>
          <span className="display num" style={{ fontSize: 48, lineHeight: 1 }}>
            {rep.purchases}
          </span>
        </div>
        <div className="card pad-s col" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="small muted">{t("disputesLost")}</span>
          <span className="display num" style={{ fontSize: 48, lineHeight: 1 }}>
            {rep.disputesLost}
          </span>
        </div>
        <div className="card pad-s col" style={{ "--gap": "4px" } as React.CSSProperties}>
          <span className="small muted">{t("guaranteeLevel")}</span>
          <span className="display" style={{ fontSize: 48, lineHeight: 1 }}>
            {levelText}
          </span>
          {g ? (
            <span className="tiny faint">
              {t("levelLimit", { limit: f.usdc(g.limitUsdc), available: f.usdc(g.availableUsdc) })}
            </span>
          ) : null}
        </div>
      </div>

      <div className="g2 gs2" style={{ "--gap": "24px", marginBottom: 24, alignItems: "start" } as React.CSSProperties}>
        <div className="card pad-s" style={{ padding: "8px 24px" }}>
          <h2 className="h3" style={{ padding: "16px 0 4px" }}>
            {t("historyTitle")}
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
                          {t("viewOnNetwork")} <Icon name="external" size="s" />
                        </a>
                      </div>
                    ) : null}
                  </div>
                  <span className="tiny faint" title={f.dateTime(h.at)}>
                    {f.ago(h.at)}
                  </span>
                </div>
              );
            })
          ) : null}
          {p.history.length > 6 ? (
            <div className="rowline">
              <button type="button" className="link-btn small" aria-expanded={allHistory} onClick={() => setAllHistory(!allHistory)}>
                {allHistory ? t("showLess") : t("showAll", { n: p.history.length })}
              </button>
            </div>
          ) : null}
          {!p.history.length ? (
            <p className="muted small" style={{ padding: "12px 0 20px" }}>
              {t("historyEmpty")}
            </p>
          ) : null}
        </div>
        <div className="card pad col" style={{ "--gap": "14px" } as React.CSSProperties}>
          <h2 className="h3">{t("howTitle")}</h2>
          <div className="row start" style={{ "--gap": "12px" } as React.CSSProperties}>
            <span className="ok">
              <Icon name="check-circle" size="s" />
            </span>
            <span className="small">{t("how1")}</span>
          </div>
          <div className="row start" style={{ "--gap": "12px" } as React.CSSProperties}>
            <span className="ok">
              <Icon name="check-circle" size="s" />
            </span>
            <span className="small">{t("how2")}</span>
          </div>
          <div className="divider" />
          <span className="small muted">{t("howNote")}</span>
        </div>
      </div>

      <div className="card-flat" style={{ padding: "26px 28px", marginBottom: 24 }}>
        <div className="row between wrapx" style={{ "--gap": "16px" } as React.CSSProperties}>
          <div className="col" style={{ "--gap": "4px" } as React.CSSProperties}>
            <h2 className="h3">{t("levelsTitle")}</h2>
            <span className="small muted">{t("levelsNote")}</span>
          </div>
          <div className="row wrapx" style={{ "--gap": "8px" } as React.CSSProperties}>
            {f.repLevels().map((l) => {
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
        text={t("techText")}
        rows={[
          { label: t("techWallet"), value: p.wallet, mono: true },
          { label: t("techNetwork"), value: config ? clusterName(config.cluster, locale) : "Solana" },
        ]}
        explorer={config ? explorerWallet(config, p.wallet) : p.explorerUrl}
      />
    </>
  );
}

export function ProfileScreen() {
  const t = useTranslations("account.profile");
  return (
    <section className="wrap" style={{ paddingTop: 44, paddingBottom: 56 }}>
      <AuthGate icon="user" title={t("gateTitle")} text={t("gateText")}>
        <Inner />
      </AuthGate>
    </section>
  );
}

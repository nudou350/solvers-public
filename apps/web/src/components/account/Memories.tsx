"use client";
// Aba "Memórias" da biblioteca (minhas-memorias.html). As memórias são criptografadas: até a carteira
// confirmar a chave, a API responde 409 memory_key_required.
import type { Memory } from "@solvers/api-client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Tile } from "@/components/ui/Tile";
import { Notice, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTxErrorMessage } from "@/lib/tx";
import { useLibrary } from "./LibraryShell";
import { useAgentsIndex } from "@/lib/hooks";
import { LoadError } from "./shared";

/** Perfil da calibragem em uma linha ("" se não há): `pergunta: resposta` ou "calibragem pulada". */
function profileLine(profile: Memory["profile"], skipped: string): string {
  if (!profile || Object.keys(profile).length === 0) return "";
  if (profile.skipped === true) return skipped;
  return Object.entries(profile)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("; ");
}

type State = { kind: "loading" } | { kind: "locked" } | { kind: "error" } | { kind: "ok"; items: Memory[] };

/** Botão com confirmação inline (sem window.confirm). */
function ConfirmDelete({
  label,
  question,
  confirmLabel,
  onConfirm,
  iconOnlyMobile,
  ariaLabel,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  iconOnlyMobile?: boolean;
  ariaLabel?: string;
}) {
  const t = useTranslations("account.memories");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <Button variant="ghost" onClick={() => setAsking(true)} aria-label={ariaLabel}>
        <Icon name="trash" size="s" />
        <span className={iconOnlyMobile ? "hide-m" : undefined}>{label}</span>
      </Button>
    );
  return (
    <div className="row wrapx" style={{ "--gap": "8px", justifyContent: "flex-end" } as React.CSSProperties} role="group" aria-label={question}>
      <span className="small bold">{question}</span>
      <Button
        variant="danger"
        size="sm"
        loading={busy}
        autoFocus
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)} disabled={busy}>
        {t("cancel")}
      </Button>
    </div>
  );
}

export function Memories() {
  const { setMemCount } = useLibrary();
  const { api, requireWallet } = useSession();
  const t = useTranslations("account");
  const f = useFormat();
  const errorInfo = useTxErrorMessage();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const items = state.kind === "ok" ? state.items : [];
  const agents = useAgentsIndex(items.map((m) => m.agentId));

  const load = useCallback(() => {
    setState({ kind: "loading" });
    api.getMemories().then(
      (m) => {
        setState({ kind: "ok", items: [...m].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      },
      (e: unknown) => setState(e instanceof ApiError && e.code === "memory_key_required" ? { kind: "locked" } : { kind: "error" }),
    );
  }, [api]);

  useEffect(load, [load]);

  const unlock = async () => {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const w = await requireWallet();
      await api.unlockMemories(w);
      load();
    } catch (e) {
      const info = errorInfo(e);
      setUnlockError(info.code === "cancelled" ? t("memories.unlockCancelled") : info.text);
    } finally {
      setUnlocking(false);
    }
  };

  const removed = (ids: string[]) => {
    setState((s) => (s.kind === "ok" ? { kind: "ok", items: s.items.filter((m) => !ids.includes(m.id)) } : s));
  };

  const count = state.kind === "ok" ? state.items.length : null;
  useEffect(() => {
    if (count != null) setMemCount(count);
  }, [count, setMemCount]);

  const fail = (e: unknown) => {
    const info = errorInfo(e);
    toast({ tone: "bad", title: t("memories.deleteFailed"), text: info.text });
  };

  const intro = (
    <div
      className="card pad row start m-col-x"
      style={
        {
          "--gap": "16px",
          marginBottom: 24,
          borderColor: "color-mix(in oklab,var(--mint) 35%,var(--line))",
          background: "linear-gradient(180deg,var(--mint-soft),var(--surface) 90%)",
        } as React.CSSProperties
      }
    >
      <span className="ok">
        <Icon name="lock" size="l" />
      </span>
      <div className="col grow" style={{ "--gap": "4px" } as React.CSSProperties}>
        <b style={{ fontSize: 17 }}>{t("memories.introTitle")}</b>
        <p className="muted">
          {t("memories.introText")}
        </p>
      </div>
      {items.length > 0 ? (
        <ConfirmDelete
          label={t("memories.deleteAll")}
          question={t("memories.deleteAllQuestion", { n: items.length })}
          confirmLabel={t("memories.deleteAll")}
          onConfirm={async () => {
            try {
              await api.deleteAllMemories();
              removed(items.map((m) => m.id));
              toast({ tone: "ok", title: t("memories.deletedAllTitle"), text: t("memories.deletedAllText") });
            } catch (e) {
              fail(e);
            }
          }}
        />
      ) : null}
    </div>
  );

  if (state.kind === "loading") return <Loading text={t("memories.loading")} />;
  if (state.kind === "error") return <LoadError onRetry={load} text={t("memories.loadError")} />;
  if (state.kind === "locked")
    return (
      <div className="empty card">
        <span className="empty-ic" style={{ background: "var(--mint-soft)", color: "var(--mint)" }}>
          <Icon name="lock" />
        </span>
        <h3 className="h4">{t("memories.lockedTitle")}</h3>
        <p className="muted small">{t("memories.lockedText")}</p>
        <Button icon="key" loading={unlocking} onClick={unlock}>
          {t("memories.confirmWallet")}
        </Button>
        {unlockError ? (
          <Notice tone="bad" role="alert">
            {unlockError}
          </Notice>
        ) : null}
      </div>
    );

  // Uma memória por especialista, mas o agrupamento aguenta mais de uma.
  const groups = [...new Set(items.map((m) => m.agentId))].map((id) => ({ id, items: items.filter((m) => m.agentId === id) }));

  return (
    <>
      {intro}
      <div className="col" style={{ "--gap": "20px" } as React.CSSProperties}>
        {groups.map((g) => {
          const a = agents.get(g.id);
          return (
            <div key={g.id} className="card" style={{ padding: 0 }}>
              <div className="row" style={{ "--gap": "14px", padding: "20px 24px", borderBottom: "1px solid var(--line)" } as React.CSSProperties}>
                {a ? <Tile category={a.category} size="s" /> : <span className="tile tile-s" aria-hidden />}
                <div className="grow">
                  <b className="trunc" style={{ display: "block" }}>{a?.name ?? t("shared.unnamedSolver")}</b>
                  <div className="small muted">{t("memories.count", { n: g.items.length })}</div>
                </div>
                {a ? (
                  <Button variant="ghost" size="sm" href={`/solvers/${encodeURIComponent(a.slug)}`} className="hide-m">
                    {t("memories.viewSolver")}
                  </Button>
                ) : null}
              </div>
              <div style={{ padding: "6px 24px" }}>
                {g.items.map((m) => (
                  <div key={m.id} className="rowline start m-col-x">
                    <div className="grow">
                      {m.summary ? <p style={{ whiteSpace: "pre-line" }}>{m.summary}</p> : null}
                      {profileLine(m.profile, t("memories.profileSkipped")) ? (
                        <p className="small" style={{ whiteSpace: "pre-line", marginTop: m.summary ? 6 : 0 }}>
                          <b>{t("memories.profileLabel")}</b> {profileLine(m.profile, t("memories.profileSkipped"))}
                        </p>
                      ) : null}
                      {m.notes.length ? (
                        <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {m.notes.map((n) => (
                            <li key={n.id}>{n.text}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="tiny faint" style={{ marginTop: 2 }}>
                        {t("memories.updated", { when: f.ago(m.updatedAt) })}
                      </div>
                    </div>
                    <ConfirmDelete
                      label={t("memories.delete")}
                      ariaLabel={t("memories.deleteAria")}
                      question={t("memories.deleteQuestion")}
                      confirmLabel={t("memories.delete")}
                      iconOnlyMobile
                      onConfirm={async () => {
                        try {
                          await api.deleteMemory(m.id);
                          removed([m.id]);
                          toast({ tone: "ok", title: t("memories.deletedTitle") });
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!groups.length ? (
          <div className="card-flat pad-l center col" style={{ "--gap": "6px", alignItems: "center" } as React.CSSProperties}>
            <b>{t("memories.emptyTitle")}</b>
            <p className="muted">{t("memories.emptyText")}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

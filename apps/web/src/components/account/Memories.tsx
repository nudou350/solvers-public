"use client";
// Aba "Memórias" da biblioteca (minhas-memorias.html). As memórias são criptografadas: até a carteira
// confirmar a chave, a API responde 409 memory_key_required.
import type { Memory } from "@solvers/api-client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Loading } from "@/components/ui/Spinner";
import { Tile } from "@/components/ui/Tile";
import { Notice, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { ago } from "@/lib/format";
import { useSession } from "@/lib/session";
import { txErrorMessage } from "@/lib/tx";
import { useLibrary } from "./LibraryShell";
import { useAgentsIndex } from "@/lib/hooks";
import { LoadError } from "./shared";

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
        Cancelar
      </Button>
    </div>
  );
}

export function Memories() {
  const { setMemCount } = useLibrary();
  const { api, requireWallet } = useSession();
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
      const info = txErrorMessage(e);
      setUnlockError(info.code === "cancelled" ? "A confirmação foi cancelada na carteira." : info.text);
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
    const info = txErrorMessage(e);
    toast({ tone: "bad", title: "Não deu para apagar", text: info.text });
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
        <b style={{ fontSize: 17 }}>Suas memórias são criptografadas e pertencem a você</b>
        <p className="muted">
          Elas ficam guardadas com criptografia e só são abertas quando você usa o especialista na sua IA. O criador não tem acesso a elas. Você pode ver e apagar tudo quando quiser.
        </p>
      </div>
      {items.length > 0 ? (
        <ConfirmDelete
          label="Apagar tudo"
          question={items.length === 1 ? "Apagar a única memória?" : `Apagar as ${items.length} memórias?`}
          confirmLabel="Apagar tudo"
          onConfirm={async () => {
            try {
              await api.deleteAllMemories();
              removed(items.map((m) => m.id));
              toast({ tone: "ok", title: "Memórias apagadas", text: "Os especialistas começam do zero na próxima conversa." });
            } catch (e) {
              fail(e);
            }
          }}
        />
      ) : null}
    </div>
  );

  if (state.kind === "loading") return <Loading text="Carregando suas memórias…" />;
  if (state.kind === "error") return <LoadError onRetry={load} text="Não conseguimos carregar suas memórias agora." />;
  if (state.kind === "locked")
    return (
      <div className="empty card">
        <span className="empty-ic" style={{ background: "var(--mint-soft)", color: "var(--mint)" }}>
          <Icon name="lock" />
        </span>
        <h3 className="h4">Suas memórias são criptografadas</h3>
        <p className="muted small">Confirme na sua carteira para ver. É só uma assinatura: nada é cobrado e nenhuma transação é enviada.</p>
        <Button icon="key" loading={unlocking} onClick={unlock}>
          Confirmar na carteira
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
                  <b className="trunc" style={{ display: "block" }}>{a?.name ?? "Especialista"}</b>
                  <div className="small muted">{g.items.length === 1 ? "1 memória" : `${g.items.length} memórias`}</div>
                </div>
                {a ? (
                  <Button variant="ghost" size="sm" href={`/especialistas/${encodeURIComponent(a.slug)}`} className="hide-m">
                    Ver especialista
                  </Button>
                ) : null}
              </div>
              <div style={{ padding: "6px 24px" }}>
                {g.items.map((m) => (
                  <div key={m.id} className="rowline start m-col-x">
                    <div className="grow">
                      <p style={{ whiteSpace: "pre-line" }}>{m.summary}</p>
                      <div className="tiny faint" style={{ marginTop: 2 }}>
                        Atualizada {ago(m.updatedAt)}
                      </div>
                    </div>
                    <ConfirmDelete
                      label="Apagar"
                      ariaLabel="Apagar esta memória"
                      question="Apagar esta memória?"
                      confirmLabel="Apagar"
                      iconOnlyMobile
                      onConfirm={async () => {
                        try {
                          await api.deleteMemory(m.id);
                          removed([m.id]);
                          toast({ tone: "ok", title: "Memória apagada" });
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
            <b>Nenhuma memória guardada</b>
            <p className="muted">Os especialistas vão anotando o que aprendem sobre você aqui. Você sempre poderá conferir.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

"use client";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type Tone = "info" | "ok" | "warn" | "bad";

const TONE_ICON: Record<Tone, IconName> = { info: "info", ok: "check-circle", warn: "warning", bad: "warning" };

/** Aviso dentro da página (inline). Use role="alert" para erros que acabaram de acontecer. */
export function Notice({
  tone = "info",
  title,
  children,
  actions,
  icon,
  role = "status",
  className,
}: {
  tone?: Tone | "brand";
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
  role?: "status" | "alert" | "note";
  className?: string;
}) {
  const cls = ["note", tone === "info" ? "" : `note-${tone}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls} role={role} aria-live={role === "note" ? undefined : role === "alert" ? "assertive" : "polite"}>
      <Icon name={icon ?? (tone === "brand" ? "info" : TONE_ICON[tone])} />
      <div className="note-body">
        {title ? <span className="note-title">{title}</span> : null}
        {children ? <span className="small">{children}</span> : null}
        {actions ? <div className="note-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export type ToastInput = { tone?: Tone; title: string; text?: string; action?: { label: string; onClick: () => void }; durationMs?: number };
type ToastItem = ToastInput & { id: number };

const ToastCtx = createContext<((t: ToastInput) => void) | null>(null);

/** Provider dos toasts (já montado no layout). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const tr = useTranslations("common.ui");
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      setItems((l) => [...l.slice(-3), { ...t, id }]);
      const ms = t.durationMs ?? (t.tone === "bad" ? 9000 : 5000);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          // Sem role nos itens: a região aria-live acima já anuncia cada aviso novo (role aqui anunciava duas vezes).
          <div key={t.id} className={`toast toast-${t.tone ?? "info"}`}>
            <Icon name={TONE_ICON[t.tone ?? "info"]} />
            <div className="note-body">
              <span className="note-title">{t.title}</span>
              {t.text ? <span className="small muted">{t.text}</span> : null}
              {t.action ? (
                <div className="note-actions">
                  <button
                    type="button"
                    className="link-btn"
                    style={{ minHeight: 32 }}
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="x" aria-label={tr("closeNotice")} onClick={() => dismiss(t.id)}>
              <Icon name="x" size="s" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** `const toast = useToast(); toast({ tone: "ok", title: "Purchase complete" })`. */
export function useToast() {
  const push = useContext(ToastCtx);
  return useMemo(() => push ?? ((t: ToastInput) => console.warn("[toast sem provider]", t.title)), [push]);
}

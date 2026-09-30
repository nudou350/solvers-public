"use client";
import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem<T extends string = string> = {
  id: T;
  label: ReactNode;
  /** Número ao lado do rótulo (chip pequeno), como "Memórias 3". */
  count?: number;
  /** Com href, a aba é um link (ex: /biblioteca e /biblioteca/memorias). */
  href?: string;
};

export type TabsProps<T extends string> = {
  tabs: TabItem<T>[];
  value: T;
  onChange?: (id: T) => void;
  "aria-label"?: string;
  className?: string;
};

/** Abas no estilo segmentado do design (.seg), com navegação por setas. */
export function Tabs<T extends string>({ tabs, value, onChange, className, ...aria }: TabsProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    e.preventDefault();
    onChange?.(next.id);
    ref.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div ref={ref} className={["seg", className ?? ""].filter(Boolean).join(" ")} role="tablist" aria-label={aria["aria-label"]} onKeyDown={onKey}>
      {tabs.map((t) => {
        const on = t.id === value;
        const content = (
          <>
            {t.label}
            {t.count != null ? (
              <span className="chip" style={{ minHeight: 22, padding: "0 8px" }}>
                {t.count}
              </span>
            ) : null}
          </>
        );
        const common = { className: on ? "on" : undefined, role: "tab", "aria-selected": on, tabIndex: on ? 0 : -1, "data-tab": t.id } as const;
        return t.href ? (
          <Link key={t.id} href={t.href} {...common} onClick={() => onChange?.(t.id)}>
            {content}
          </Link>
        ) : (
          <button key={t.id} type="button" {...common} onClick={() => onChange?.(t.id)}>
            {content}
          </button>
        );
      })}
    </div>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { repCls, repLevel } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

export type ChipTone = "default" | "ok" | "brand" | "warn" | "red" | "plain";

/** Chip/badge do design (.chip). Para filtros clicáveis use <button className="chip on">. */
export function Chip({ tone = "default", icon, children, className }: { tone?: ChipTone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={["chip", tone !== "default" ? `chip-${tone}` : "", className ?? ""].filter(Boolean).join(" ")}>
      {icon ? <Icon name={icon} size="s" /> : null}
      {children}
    </span>
  );
}

/**
 * Selo de reputação (0..100) com o nível do design: Referência, Confiável, Em crescimento...
 * `children` troca o texto (ex: "Criador confiável"); o tom e o ícone seguem o nível.
 */
export function RepBadge({ score, showScore = false, children, style }: { score: number; showScore?: boolean; children?: ReactNode; style?: CSSProperties }) {
  const lv = repLevel(score);
  return (
    <span className={repCls(score)} title={`Reputação ${Math.round(score)}/100`} style={style}>
      <Icon name={lv.tone === "warn" ? "warning" : "shield-check"} size="s" />
      {children ?? <span>{lv.label}</span>}
      {showScore ? <span className="num">· {Math.round(score)}</span> : null}
    </span>
  );
}

/** "Compra verificada" (ou outro texto) em verde. */
export function Verified({ children = "Compra verificada" }: { children?: ReactNode }) {
  return (
    <span className="verified">
      <Icon name="check-circle" size="s" />
      {children}
    </span>
  );
}

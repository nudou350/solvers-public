import type { ReactNode } from "react";
import { repLevel } from "@/lib/format";
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

/** Selo de reputação (0..100) com o nível do design: Referência, Confiável, Em crescimento... */
export function RepBadge({ score, showScore = false }: { score: number; showScore?: boolean }) {
  const lv = repLevel(score);
  return (
    <span className={["rep", lv.tone === "ok" ? "" : lv.tone].filter(Boolean).join(" ")} title={`Reputação ${Math.round(score)}/100`}>
      <Icon name={lv.tone === "warn" ? "warning" : "shield-check"} size="s" />
      {lv.label}
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

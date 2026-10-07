import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { repCls, useFormat } from "@/lib/format";
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
 * Selo de reputação (0..100) com o nível do design: Reference, Trusted, Growing...
 * `children` troca o texto (ex: "Trusted creator"); o tom e o ícone seguem o nível.
 */
export function RepBadge({ score, showScore = false, children, style }: { score: number; showScore?: boolean; children?: ReactNode; style?: CSSProperties }) {
  const f = useFormat();
  const t = useTranslations("common.ui");
  const lv = f.repLevel(score);
  return (
    <span className={repCls(score)} title={t("reputationTitle", { score: Math.round(score) })} style={style}>
      <Icon name={lv.tone === "warn" ? "warning" : "shield-check"} size="s" />
      {children ?? <span>{lv.label}</span>}
      {showScore ? <span className="num">· {Math.round(score)}</span> : null}
    </span>
  );
}

/** "Verified purchase" (ou outro texto) em verde. */
export function Verified({ children }: { children?: ReactNode }) {
  const t = useTranslations("common.ui");
  return (
    <span className="verified">
      <Icon name="check-circle" size="s" />
      {children ?? t("verifiedPurchase")}
    </span>
  );
}

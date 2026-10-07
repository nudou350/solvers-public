import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { starPct, useFormat } from "@/lib/format";

export type StarsProps = {
  /** Nota de 0 a 5. */
  rating: number;
  /** Mostra a nota ao lado ("4.8"). */
  showValue?: boolean;
  /** Total de avaliações, mostrado como "(120)". */
  count?: number;
  className?: string;
};

/** Estrelas preenchidas proporcionalmente (máscara SVG do design). */
export function Stars({ rating, showValue, count, className }: StarsProps) {
  const f = useFormat();
  const t = useTranslations("common.ui");
  const label = count != null ? t("ratingLabelWithCount", { rating: f.dec1(rating), count }) : t("ratingLabel", { rating: f.dec1(rating) });
  const stars = <span className="stars" style={{ "--p": `${starPct(rating)}%` } as CSSProperties} role="img" aria-label={label} />;
  if (!showValue && count == null) return <span className={className}>{stars}</span>;
  return (
    <span className={["stars-row", className ?? ""].filter(Boolean).join(" ")}>
      {stars}
      {showValue ? (
        <span className="bold num" aria-hidden>
          {f.dec1(rating)}
        </span>
      ) : null}
      {count != null ? (
        <span className="small faint num" aria-hidden>
          ({f.int(count)})
        </span>
      ) : null}
    </span>
  );
}

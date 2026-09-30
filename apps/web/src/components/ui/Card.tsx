import Link from "next/link";
import type { CSSProperties, ElementType, ReactNode } from "react";

export type CardProps = {
  /** Espaçamento interno: s = 20px, m = 28px (padrão), l = 36px, none = sem padding. */
  pad?: "none" | "s" | "m" | "l";
  /** Variante plana (.card-flat: fundo surface-2, sem borda). */
  flat?: boolean;
  /** Vira link, com o efeito de hover do design. */
  href?: string;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "aria-label"?: string;
};

export function Card({ pad = "m", flat, href, as, className, style, children, ...aria }: CardProps) {
  const cls = [flat ? "card-flat" : "card", pad === "none" ? "" : pad === "m" ? "pad" : `pad-${pad}`, className ?? ""].filter(Boolean).join(" ");
  if (href)
    return (
      <Link href={href} className={cls} style={style} aria-label={aria["aria-label"]}>
        {children}
      </Link>
    );
  const Tag: ElementType = as ?? "div";
  return (
    <Tag className={cls} style={style} aria-label={aria["aria-label"]}>
      {children}
    </Tag>
  );
}

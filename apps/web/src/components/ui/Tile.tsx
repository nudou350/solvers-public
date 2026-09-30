import type { CSSProperties } from "react";
import { categoryIcon, hue, initials } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

/** Identidade visual do especialista: quadrado com a cor e o ícone da categoria (.tile). */
export function Tile({ category, icon, size = "m", className }: { category: string; icon?: IconName; size?: "s" | "m" | "l"; className?: string }) {
  return (
    <span
      className={["tile", size !== "m" ? `tile-${size}` : "", className ?? ""].filter(Boolean).join(" ")}
      style={{ "--h": hue(category) } as CSSProperties}
      aria-hidden
    >
      <Icon name={icon ?? categoryIcon(category)} />
    </span>
  );
}

/** Avatar com iniciais (.av). Com `src`, mostra a imagem. */
export function Avatar({ name, src, size = "m", className }: { name: string; src?: string | null; size?: "s" | "m" | "l"; className?: string }) {
  const cls = ["av", size !== "m" ? `av-${size}` : "", className ?? ""].filter(Boolean).join(" ");
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cls} src={src} alt="" style={{ objectFit: "cover" }} />;
  return (
    <span className={cls} aria-hidden>
      {initials(name)}
    </span>
  );
}

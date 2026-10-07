import { Link } from "@/i18n/navigation";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "ok" | "danger";

type Common = {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  /** Mostra o spinner e desabilita. */
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  className?: string;
  children?: ReactNode;
};

type AsButton = Common & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
type AsLink = Common & { href: string; target?: string; rel?: string; "aria-label"?: string; onClick?: () => void; prefetch?: boolean };
export type ButtonProps = AsButton | AsLink;

/** Classes do botão, para quem precisa aplicar o estilo em outro elemento. */
export function buttonClass({ variant = "primary", size = "md", block, loading, className }: Omit<Common, "children">) {
  return ["btn", `btn-${variant}`, size === "lg" ? "btn-lg" : size === "sm" ? "btn-sm" : "", block ? "btn-block" : "", loading ? "is-loading" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
}

/** Botão do design (.btn). Com `href` vira link (next/link nas rotas internas). */
export function Button(props: ButtonProps) {
  const { variant, size, block, loading, icon, iconRight, className, children } = props;
  const cls = buttonClass({ variant, size, block, loading, className });
  const inner = (
    <>
      {icon ? <Icon name={icon} size="s" /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size="s" /> : null}
      {loading ? <Spinner size="s" /> : null}
    </>
  );
  if (props.href !== undefined) {
    const { href, target, rel, onClick, prefetch } = props;
    if (/^https?:/.test(href))
      return (
        <a className={cls} href={href} target={target ?? "_blank"} rel={rel ?? "noopener noreferrer"} onClick={onClick} aria-label={props["aria-label"]}>
          {inner}
        </a>
      );
    return (
      <Link className={cls} href={href} onClick={onClick} prefetch={prefetch} aria-label={props["aria-label"]}>
        {inner}
      </Link>
    );
  }
  const { variant: _v, size: _s, block: _b, loading: _l, icon: _i, iconRight: _r, className: _c, children: _ch, href: _h, ...rest } = props;
  return (
    <button type="button" {...rest} className={cls} disabled={rest.disabled || loading} aria-busy={loading || undefined}>
      {inner}
    </button>
  );
}

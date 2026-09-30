import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type EmptyProps = {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  /** Botões/links (ex: <Button href="/">Explorar especialistas</Button>). */
  action?: ReactNode;
  /** Dentro de um card (padrão) ou solto. */
  bare?: boolean;
};

/** Estado vazio (e de erro): ícone, título, texto e ação. */
export function Empty({ icon = "sparkles", title, children, action, bare }: EmptyProps) {
  return (
    <div className={["empty", bare ? "" : "card"].filter(Boolean).join(" ")}>
      <span className="empty-ic">
        <Icon name={icon} />
      </span>
      <h3 className="h4">{title}</h3>
      {children ? <p className="muted small">{children}</p> : null}
      {action ? <div className="row wrapx" style={{ justifyContent: "center" }}>{action}</div> : null}
    </div>
  );
}

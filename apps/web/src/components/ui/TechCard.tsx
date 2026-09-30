"use client";
import { useId, useState, type CSSProperties } from "react";
import { gap } from "@/lib/style";
import { Icon } from "./Icon";

export type TechRow = { label: string; value: string; mono?: boolean };

/** "Quer conferir os detalhes técnicos?": abre a lista de contas na rede e o link do explorador. */
export function TechCard({ text, rows, explorer, style }: { text: string; rows: TechRow[]; explorer?: string | null; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="card pad col" style={gap(6, { alignItems: "flex-start", ...style })}>
      <div className="row wrapx" style={gap(12)}>
        <span className="brand">
          <Icon name="shield-check" size="l" />
        </span>
        <div>
          <b>Quer conferir os detalhes técnicos?</b>
          <div className="small muted">{text}</div>
        </div>
      </div>
      <button type="button" className="link-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {open ? "Ocultar detalhes técnicos" : "Verificar na blockchain"}
      </button>
      {open ? (
        <dl className="tech" id={id} style={{ width: "100%" }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "contents" }}>
              <dt>{r.label}</dt>
              <dd className={r.mono ? "mono" : undefined}>{r.value}</dd>
            </div>
          ))}
          {explorer ? (
            <dd>
              <a className="link small" href={explorer} target="_blank" rel="noopener noreferrer">
                Abrir no explorador da rede <Icon name="external" size="s" />
              </a>
            </dd>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

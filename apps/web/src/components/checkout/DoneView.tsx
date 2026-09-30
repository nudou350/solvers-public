"use client";
// Compra concluída (design: compra-concluida): licença, créditos ou tarefa com garantia.
import type { AgentDetail } from "@solvers/api-client";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";
import { Tile } from "@/components/ui/Tile";
import { brl, date, usdc } from "@/lib/format";
import { clusterName, explorerLink, trustedExplorerUrl } from "@/lib/explorer";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { type DoneKind } from "./util";

const CONFETTI: [number, number, number][] = [
  [6, 12, 30], [12, 58, -40], [18, 22, 70], [24, 80, 15], [30, 8, -25], [36, 46, 55], [42, 90, -60], [50, 6, 20], [58, 70, -35], [64, 14, 45],
  [72, 86, -15], [78, 30, 60], [84, 10, -50], [90, 62, 25], [95, 24, -30], [4, 38, 80], [46, 36, -70], [70, 50, 10], [88, 84, -45], [16, 92, 35],
];

export type DoneProps = {
  detail: AgentDetail;
  kind: DoneKind;
  sig: string | null;
  escrow: string | null;
  asset: string | null;
  paidUsdc: number | null;
  credits: number | null;
  /** explorerUrl que o servidor devolveu no submit (validado aqui); sem ele, o link é montado pela config. */
  explorer: string | null;
};

/** A URL diz o que foi comprado; a conta confirma. "unknown" = sem sessão para conferir (não bloqueia nada). */
type Check = "checking" | "ok" | "missing" | "unknown";

export function DoneView({ detail, kind, sig, escrow, asset, paidUsdc, credits, explorer }: DoneProps) {
  const { api, config, status } = useSession();
  const [check, setCheck] = useState<Check>("checking");
  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authed") return setCheck("unknown");
    let alive = true;
    const confirm =
      kind === "escrow"
        ? escrow
          ? api.getMyEscrow(escrow).then(() => true)
          : Promise.resolve(false)
        : api.getMyAccess(detail.agent.slug).then((a) => (kind === "credits" ? (a.creditsLeft ?? 0) > 0 : !!a.license));
    confirm.then(
      (ok) => alive && setCheck(ok ? "ok" : "missing"),
      () => alive && setCheck("missing"),
    );
    return () => {
      alive = false;
    };
  }, [api, status, kind, escrow, detail.agent.slug]);
  const { agent } = detail;
  const [tech, setTech] = useState(false);
  // Data de hoje só no navegador (evita divergência de hidratação por fuso).
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(date(new Date().toISOString())), []);

  const paid = paidUsdc ?? (kind === "escrow" ? (detail.guarantee?.priceUsdc ?? agent.priceUsdc) : agent.priceUsdc);
  const rate = config?.brlPerUsd ?? null;
  const isEscrow = kind === "escrow";
  const account = isEscrow ? escrow : asset;
  const txLink = sig ? (trustedExplorerUrl(explorer) ?? (config ? explorerLink(config, "tx", sig) : null)) : null;

  const heading = isEscrow ? `Pronto! Sua tarefa com o ${agent.name} começou.` : kind === "credits" ? `Pronto! Seus créditos do ${agent.name} chegaram.` : `Pronto! O ${agent.name} é seu.`;
  const lead = isEscrow
    ? "O pagamento está guardado e só vai para o criador quando você aprovar cada etapa. Conecte o especialista à sua IA para ele começar a trabalhar na tarefa."
    : kind === "credits"
      ? "Os créditos já estão na sua conta. Falta só conectar o especialista à sua IA. Leva uns 5 minutos e a gente guia cada passo."
      : "Sua licença permanente já está na sua conta. Falta só conectar o especialista à sua IA. Leva uns 5 minutos e a gente guia cada passo.";

  return (
    <section className="wrap" style={{ position: "relative", paddingTop: 56, paddingBottom: 72 }}>
      <div className="confetti" aria-hidden>
        {CONFETTI.map(([l, t, r], i) => (
          <i key={i} style={{ left: `${l}%`, top: `${t}%`, "--r": `${r}deg` } as CSSProperties} />
        ))}
      </div>
      <div className="col center" style={{ ...gap(22), alignItems: "center", position: "relative", maxWidth: 720, margin: "0 auto" }}>
        <span
          className="pop"
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "var(--mint)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 18px 40px -12px color-mix(in oklab,var(--mint) 60%,transparent)",
          }}
        >
          <Icon name="check" size="xl" />
        </span>
        {check === "missing" ? (
          <Notice
            tone="warn"
            title="Ainda não encontramos esta compra na sua conta"
            actions={
              <Button size="sm" variant="secondary" href={isEscrow ? "/garantias" : "/biblioteca"}>
                {isEscrow ? "Ver minhas garantias" : "Ver minha biblioteca"}
              </Button>
            }
          >
            Se você acabou de pagar, ela aparece em instantes. Se entrou com outra conta, confira na conta usada na compra.
          </Notice>
        ) : (
          <span className="chip chip-ok" aria-live="polite">
            {check === "checking" ? "Conferindo o pagamento…" : isEscrow ? "Pagamento guardado" : "Pagamento confirmado"}
          </span>
        )}
        <h1 className="display h1s" style={{ fontSize: 60 }}>
          {heading}
        </h1>
        <p className="lead">{lead}</p>

        <div className="ticket" style={{ width: "100%", maxWidth: 520, textAlign: "left", padding: 26 }}>
          <div className="sol-line" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, borderRadius: 0 }} />
          <div className="row between">
            <span className="eyebrow">{isEscrow ? "Sua tarefa" : kind === "credits" ? "Seus créditos" : "Sua licença"}</span>
            <span className={`chip ${isEscrow ? "chip-brand" : "chip-ok"}`}>
              <Icon name={isEscrow ? "shield-check" : "check"} size="s" />
              {isEscrow ? "Em andamento" : "Ativa"}
            </span>
          </div>
          <div className="row" style={{ ...gap(16), margin: "18px 0" }}>
            <Tile category={agent.category} size="l" />
            <div>
              <div className="display" style={{ fontSize: 30, lineHeight: 1.05 }}>
                {agent.name}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {isEscrow
                  ? `Tarefa com garantia · ${detail.guarantee?.milestones.length ?? 0} etapas`
                  : kind === "credits"
                    ? `${credits != null ? `${credits} usos` : "Créditos de uso"} · versão ${agent.version}`
                    : `Licença permanente · versão ${agent.version}`}
              </div>
            </div>
          </div>
          <div className="cut" style={{ margin: "0 -26px 16px" }} />
          <div className="row between small">
            <span className="muted">{today ? `${isEscrow ? "Criada" : "Emitida"} em ${today}` : " "}</span>
            <span className="muted">
              {isEscrow ? "Guardado" : "Pago"}:{" "}
              <b className="num" style={{ color: "var(--ink)" }}>
                {rate != null ? brl(paid, rate) : usdc(paid)}
              </b>
            </span>
          </div>
        </div>

        <div className="row wrapx m-col" style={{ ...gap(12), justifyContent: "center", width: "100%" }}>
          <Button size="lg" href={`/instalar?agent=${agent.slug}`} iconRight="arrow-right">
            Conectar à minha IA
          </Button>
          {isEscrow ? (
            <Button size="lg" variant="secondary" href="/garantias" icon="shield-check">
              Acompanhar em Garantias
            </Button>
          ) : (
            <Button size="lg" variant="secondary" href="/biblioteca">
              Ver minha biblioteca
            </Button>
          )}
        </div>

        {sig ? (
          <>
            <button type="button" className="link-btn small" onClick={() => setTech((v) => !v)} aria-expanded={tech} aria-controls="detalhes-tecnicos">
              {tech ? "Ocultar detalhes técnicos" : isEscrow ? "Ver detalhes técnicos da tarefa" : kind === "credits" ? "Ver detalhes técnicos da compra" : "Ver detalhes técnicos da licença"}
            </button>
            {tech ? (
              <dl id="detalhes-tecnicos" className="tech" style={{ marginTop: 14, textAlign: "left", width: "100%", maxWidth: 520 }}>
                {account ? (
                  <>
                    <dt>{isEscrow ? "Tarefa registrada na rede" : "Licença registrada na rede"}</dt>
                    <dd className="mono">{account}</dd>
                  </>
                ) : null}
                <dt>Comprovante do pagamento</dt>
                <dd className="mono">{sig}</dd>
                {config ? (
                  <>
                    <dt>Rede</dt>
                    <dd>{clusterName(config.cluster)}</dd>
                  </>
                ) : null}
                {txLink ? (
                  <a className="link small" href={txLink} target="_blank" rel="noopener noreferrer">
                    Abrir no explorador da rede <Icon name="external" size="s" />
                  </a>
                ) : null}
              </dl>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

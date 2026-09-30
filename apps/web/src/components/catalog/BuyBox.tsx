"use client";
import type { TrialInfo } from "@solvers/api-client";
import { type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { brlValue, usdc } from "@/lib/format";
import { useMyAccess } from "@/lib/hooks";
import { gap } from "@/lib/style";
import { usesText } from "./TrialBlock";

export type BuyBoxProps = {
  slug: string;
  name: string;
  priceUsdc: number;
  priceBrl: number | null;
  /** Teste grátis configurado pelo especialista; null = não tem teste. */
  trial: TrialInfo | null;
  hasGuarantee: boolean;
  rate: number;
};

/** Caixa de compra da página do especialista: licença permanente, teste grátis (se houver) e acesso do usuário logado. */
export function BuyBox(p: BuyBoxProps) {
  const access = useMyAccess(p.slug);
  const price = p.priceBrl != null ? brlValue(p.priceBrl) : brlValue(p.priceUsdc * p.rate);
  const checkout = `/checkout?agent=${encodeURIComponent(p.slug)}&type=permanent`;
  const install = `/instalar?agent=${encodeURIComponent(p.slug)}`;
  const owned = !!access?.license;
  const trialLeft = p.trial && access ? access.trialUsesLeft : null;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="sol-line" style={{ borderRadius: 0, height: 4 }} />
      <div className="pad col" style={gap("18px")}>
        {owned ? (
          <div className="note note-ok" role="status">
            <Icon name="check-circle" />
            <div className="note-body">
              <span className="note-title">Você já tem este especialista</span>
              <span className="small">Sua licença permanente está ativa. Conecte à sua IA para usar.</span>
              <div className="note-actions">
                <Button href={install} size="sm" iconRight="arrow-right">
                  Ir para a instalação
                </Button>
                <Button href="/biblioteca" size="sm" variant="secondary">
                  Minha biblioteca
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {owned ? null : (
          <>
            <div className="col" style={gap("2px")}>
              <span className="eyebrow">Licença permanente</span>
              <div className="row price-row" style={gap("10px", { alignItems: "baseline" })}>
                <span className="display big num price-big" style={{ fontSize: 60, whiteSpace: "nowrap" }}>
                  {price}
                </span>
                <span className="muted">pagamento único</span>
              </div>
              <span className="small faint">{usdc(p.priceUsdc)} · cotação de hoje</span>
            </div>
            <Button href={checkout} size="lg" block iconRight="arrow-right">
              Comprar licença
            </Button>
            {p.trial ? (
              <div className="col" style={gap("8px")}>
                <Button href={install} variant="secondary" block icon="play">
                  Testar grátis
                </Button>
                <p className="small muted center" role="status">
                  {trialLeft == null
                    ? `${usesText(p.trial.uses)} para experimentar. `
                    : trialLeft > 0
                      ? `Restam ${trialLeft} de ${usesText(p.trial.uses)}. `
                      : "Seu teste grátis acabou. "}
                  <a className="link" href="#teste-gratis">
                    Ver o que o teste inclui
                  </a>
                </p>
              </div>
            ) : null}
          </>
        )}
        <ul className="col small" style={gap("10px")}>
          <Check>Licença registrada na rede Solana, em seu nome.</Check>
          {p.trial ? <Check>O teste grátis acontece na sua IA, pelo conector.</Check> : null}
          <Check>{p.hasGuarantee ? "Garantia de resultado disponível para tarefas." : "Sem garantia de resultado para este especialista."}</Check>
        </ul>
        {p.hasGuarantee ? (
          <>
            <div className="divider" />
            <a className="row between" href="#garantia" style={gap("12px")}>
              <span className="col" style={gap("2px")}>
                <span className="small faint">Prefere pagar só pelo resultado?</span>
                <b>Tarefa com garantia</b>
              </span>
              <Icon name="arrow-right" />
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="row start" style={gap("10px")}>
      <span className="ok">
        <Icon name="check-circle" size="s" />
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}

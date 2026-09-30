"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { brlValue, usdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";

type Access = { license: string | null; creditsLeft: number | null; trialUsesLeft: number };

export type BuyBoxProps = {
  slug: string;
  name: string;
  priceUsdc: number;
  priceBrl: number | null;
  pricePerUseUsdc: number | null;
  pricePerUseBrl: number | null;
  freeTrialUses: number;
  hasGuarantee: boolean;
  rate: number;
};

/** Caixa de compra da página do especialista: licença permanente ou por uso, teste grátis e acesso do usuário logado. */
export function BuyBox(p: BuyBoxProps) {
  const { api, status } = useSession();
  const perUse = p.pricePerUseUsdc != null;
  const [type, setType] = useState<"permanent" | "credits">("permanent");
  const [access, setAccess] = useState<Access | null>(null);

  useEffect(() => {
    if (status !== "authed") {
      setAccess(null);
      return;
    }
    let live = true;
    api.getMyAccess(p.slug).then(
      (a) => live && setAccess(a),
      () => live && setAccess(null),
    );
    return () => {
      live = false;
    };
  }, [api, status, p.slug]);

  const perm = type === "permanent" || !perUse;
  const reais = (u: number, b: number | null) => (b != null ? brlValue(b) : brlValue(u * p.rate));
  const buy = perm
    ? { label: "Licença permanente", main: reais(p.priceUsdc, p.priceBrl), unit: "pagamento único", usdc: usdc(p.priceUsdc), cta: "Comprar licença" }
    : { label: "Pagamento por uso", main: reais(p.pricePerUseUsdc ?? 0, p.pricePerUseBrl), unit: "por uso", usdc: usdc(p.pricePerUseUsdc ?? 0), cta: "Pagar por uso" };
  const checkout = `/checkout?agent=${encodeURIComponent(p.slug)}&type=${perm ? "permanent" : "credits"}`;
  const install = `/instalar?agent=${encodeURIComponent(p.slug)}`;
  const owned = !!access?.license;
  const trialLeft = access?.trialUsesLeft ?? null;

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
          <span className="eyebrow">{buy.label}</span>
          <div className="row price-row" style={gap("10px", { alignItems: "baseline" })}>
            <span className="display big num price-big" style={{ fontSize: 60, whiteSpace: "nowrap" }}>
              {buy.main}
            </span>
            <span className="muted">{buy.unit}</span>
          </div>
          <span className="small faint">{buy.usdc} · cotação de hoje</span>
        </div>
        {perUse ? (
          <div className="col" style={gap("10px")} role="radiogroup" aria-label="Forma de pagamento">
            <button type="button" role="radio" className={`opt${perm ? " on" : ""}`} aria-checked={perm} onClick={() => setType("permanent")}>
              <span className="dot-r" />
              <span className="col" style={gap("2px")}>
                <b>Licença permanente</b>
                <span className="small muted">Pague uma vez e use para sempre.</span>
              </span>
            </button>
            <button type="button" role="radio" className={`opt${perm ? "" : " on"}`} aria-checked={!perm} onClick={() => setType("credits")}>
              <span className="dot-r" />
              <span className="col" style={gap("2px")}>
                <b>Pagamento por uso</b>
                <span className="small muted">{reais(p.pricePerUseUsdc ?? 0, p.pricePerUseBrl)} por uso, sem compromisso.</span>
              </span>
            </button>
          </div>
        ) : null}
        <Button href={checkout} size="lg" block iconRight="arrow-right">
          {buy.cta}
        </Button>
        <Button href={install} variant="secondary" block icon="play">
          Testar grátis ({p.freeTrialUses} usos)
        </Button>
          </>
        )}
        {!owned && trialLeft != null ? (
          <p className="small muted center" role="status">
            {trialLeft > 0 ? `${trialLeft} de ${p.freeTrialUses} usos grátis restantes` : `Seus ${p.freeTrialUses} usos grátis acabaram`}
          </p>
        ) : null}
        {(access?.creditsLeft ?? 0) > 0 && access ? (
          <p className="small muted center">
            Você tem {access.creditsLeft} {access.creditsLeft === 1 ? "uso pago restante" : "usos pagos restantes"}.
          </p>
        ) : null}
        <ul className="col small" style={gap("10px")}>
          <Check>Licença registrada na rede Solana, em seu nome.</Check>
          <Check>O teste grátis acontece na sua IA, pelo conector.</Check>
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
      <span>{children}</span>
    </li>
  );
}

"use client";
import type { AgentSupply, TrialInfo } from "@solvers/api-client";
import Link from "next/link";
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
  /** Revenda ligada (config.resaleEnabled): liberam "Licença usada" e, para quem já tem a licença, "Anunciar minha licença". */
  resaleOn?: boolean;
  /** Anúncio de revenda mais barato deste especialista (null/ausente: nada à venda). */
  resale?: { listingId: string; floorUsdc: number } | null;
  /** Teto de licenças (vendidas / máximo). Ausente ou `max: null` = ilimitado. */
  supply?: AgentSupply;
  /** Especialista da plataforma: gratuito, sem licença nem compra. Esconde preço e botão de compra. */
  platform?: boolean;
};

/** Caixa da página de um especialista da plataforma: sem preço nem compra, só como instalar. */
function PlatformBox({ slug }: { slug: string }) {
  const install = `/instalar?agent=${encodeURIComponent(slug)}`;
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="sol-line" style={{ borderRadius: 0, height: 4 }} />
      <div className="pad col" style={gap("18px")}>
        <div className="col" style={gap("4px")}>
          <span className="eyebrow">Incluído na plataforma</span>
          <span className="display big num" style={{ fontSize: 56, whiteSpace: "nowrap" }}>
            Gratuito
          </span>
          <span className="small faint">Sem compra, sem licença e sem pagamento.</span>
        </div>
        <Button href={install} size="lg" block iconRight="arrow-right">
          Instalar na minha IA
        </Button>
        <ol className="col small" style={gap("10px")}>
          <Step n={1}>Copie o endereço do conector do Solvers.</Step>
          <Step n={2}>Cole no Claude ou no ChatGPT e autorize com a sua conta.</Step>
          <Step n={3}>Peça o que você precisa e cite o especialista pelo nome.</Step>
        </ol>
        <ul className="col small" style={gap("10px")}>
          <Check>O mesmo conector serve para todos os especialistas que você tiver.</Check>
          <Check>Você só precisa entrar na sua conta do Solvers.</Check>
        </ul>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="row start" style={gap("10px")}>
      <span className="dot dot-now" aria-hidden style={{ width: 24, height: 24, fontSize: 12, borderWidth: 1.5 }}>
        {n}
      </span>
      <span className="grow">{children}</span>
    </li>
  );
}

/** Caixa de compra da página do especialista: licença permanente, teste grátis (se houver) e acesso do usuário logado. */
export function BuyBox(p: BuyBoxProps) {
  if (p.platform) return <PlatformBox slug={p.slug} />;
  return <PaidBox {...p} />;
}

function PaidBox(p: BuyBoxProps) {
  const access = useMyAccess(p.slug);
  const price = p.priceBrl != null ? brlValue(p.priceBrl) : brlValue(p.priceUsdc * p.rate);
  const checkout = `/checkout?agent=${encodeURIComponent(p.slug)}&type=permanent`;
  const install = `/instalar?agent=${encodeURIComponent(p.slug)}`;
  const owned = !!access?.license;
  const usedHref = p.resale ? `/checkout?listing=${encodeURIComponent(p.resale.listingId)}` : null;
  const trialLeft = p.trial && access ? access.trialUsesLeft : null;
  const soldOut = !owned && p.supply?.left === 0;
  const limited = p.supply?.max != null && p.supply.left != null && p.supply.left > 0;

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
                {p.resaleOn ? (
                  <Button href="/biblioteca" size="sm" variant="ghost" icon="tag">
                    Anunciar minha licença
                  </Button>
                ) : null}
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
            {limited && p.supply ? (
              <span className="small" role="status">
                <Icon name="tag" size="s" /> <b>Restam {p.supply.left} de {p.supply.max} licenças.</b> Limite atual verificado na blockchain; o criador só pode aumentá-lo, nunca reduzi-lo.
              </span>
            ) : null}
            {soldOut ? (
              <div className="col" style={gap("8px")}>
                <Button size="lg" block disabled>
                  Esgotado
                </Button>
                <p className="small muted" role="status">
                  Todas as licenças deste especialista já foram vendidas. {p.resaleOn ? "Veja se alguém está vendendo uma usada." : "Quem já tem uma licença pode revendê-la quando o mercado de revenda abrir."}
                </p>
              </div>
            ) : (
              <Button href={checkout} size="lg" block iconRight="arrow-right">
                Comprar licença
              </Button>
            )}
            {p.resaleOn && usedHref && p.resale ? (
              <Link className="row between card-flat pad-s" href={usedHref} style={gap("12px")}>
                <span className="col" style={gap("2px")}>
                  <span className="small faint">Prefere pagar menos?</span>
                  <b>Licença usada a partir de {brlValue(p.resale.floorUsdc * p.rate)}</b>
                  <span className="tiny faint">Mesma nota do especialista. As memórias de quem vende não vão junto.</span>
                </span>
                <Icon name="arrow-right" />
              </Link>
            ) : null}
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

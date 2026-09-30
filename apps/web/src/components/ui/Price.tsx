import { brl, brl0, brlValue, usdc as fmtUsdc } from "@/lib/format";

export type PriceProps = {
  /** Valor em USDC (fonte da verdade). */
  usdc: number;
  /** Cotação R$/USD (getConfig().brlPerUsd ou useRate()). Sem ela e sem `brl`, mostra só USDC. */
  rate?: number | null;
  /** Valor já em reais (ex: AgentDetail.priceBrl); tem prioridade sobre `rate`. */
  brl?: number | null;
  size?: "s" | "m" | "l" | "xl";
  /** Reais sem centavos (cartões). */
  round?: boolean;
  /** R$ e USDC na mesma linha. */
  inline?: boolean;
  /** Texto depois do USDC, ex: "por uso". */
  suffix?: string;
  className?: string;
};

/** Preço: R$ em destaque e USDC como informação secundária, como no design. */
export function Price({ usdc, rate, brl: reais, size = "m", round, inline, suffix, className }: PriceProps) {
  const main = reais != null ? brlValue(reais, round ? 0 : 2) : rate != null ? (round ? brl0(usdc, rate) : brl(usdc, rate)) : null;
  const sub = `${fmtUsdc(usdc)}${suffix ? ` ${suffix}` : ""}`;
  const cls = ["price", `price-${size}`, inline ? "inline" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls}>
      <span className="price-main">{main ?? sub}</span>
      {main ? <span className="price-sub">{sub}</span> : null}
    </span>
  );
}

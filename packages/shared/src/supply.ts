import { z } from "zod";

// Teto de licenças por solver (docs/licencas-limitadas.md). O teto vive on-chain (`SupplyCap`, imposto por
// `purchase_license`); o servidor só o espelha em `agents.max_licenses` para a vitrine e para barrar a compra antes de
// montar a transação. O contador é `Agent.total_sales` (licenças já emitidas na vida do solver): queimar ou revender
// uma licença NÃO reabre vaga.

/** Teto máximo que um manifest pode pedir. `u32::MAX` on-chain equivale a ilimitado (ver `SUPPLY_UNLIMITED`). */
export const MAX_LICENSES_CAP = 1_000_000;

/** Valor de `SupplyCap.max` que significa ilimitado (`raise_supply_cap(u32::MAX)`). */
export const SUPPLY_UNLIMITED = 0xffff_ffff;

/** `max` e `left` são `null` quando o solver é ilimitado. `sold` conta as licenças já emitidas. */
export const AgentSupply = z.object({
  max: z.number().int().nullable(),
  sold: z.number().int(),
  left: z.number().int().nullable(),
});
export type AgentSupply = z.infer<typeof AgentSupply>;

export const UNLIMITED_SUPPLY: AgentSupply = { max: null, sold: 0, left: null };

/** Códigos de erro de compra por teto; web e MCP reagem ao `code` (mesmo padrão de `RESALE_ERROR_CODES`). */
export const SUPPLY_ERROR_CODES = {
  soldOut: "sold_out",
} as const;
export type SupplyErrorCode = (typeof SUPPLY_ERROR_CODES)[keyof typeof SUPPLY_ERROR_CODES];

export const SUPPLY_ERROR_HTTP_STATUS: Record<SupplyErrorCode, number> = {
  sold_out: 409,
};

/** Teto do espelho: `null` quando ilimitado (conta ausente ou `u32::MAX`). */
export function normalizeMaxLicenses(onchainMax: number | null | undefined): number | null {
  if (onchainMax == null || onchainMax >= SUPPLY_UNLIMITED) return null;
  return onchainMax;
}

/** `left = max - sold` (nunca negativo); `null` se ilimitado. */
export function toAgentSupply(max: number | null, sold: number): AgentSupply {
  if (max == null) return { max: null, sold, left: null };
  return { max, sold, left: Math.max(0, max - sold) };
}

export function isSoldOut(supply: AgentSupply): boolean {
  return supply.left === 0;
}

/** Texto de "esgotado". `resale`: a revenda está ligada, então dá para sugerir o mercado de licenças usadas. */
export function soldOutText(name: string, resale = false): string {
  const base = `${name} está esgotado: o limite atual de licenças já foi vendido (o criador pode aumentá-lo).`;
  return resale ? `${base} Quem já tem uma pode revendê-la: veja se há licença à venda no mercado de revenda.` : base;
}

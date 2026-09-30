import type { GuaranteeLevel } from "./schemas.js";

// Regras de conversão e cálculo compartilhadas (INSTRUCTIONS.md 3 e 5.9).

export const USDC_DECIMALS = 6;
const USDC_UNIT = 1_000_000n;

/** Preço mínimo de licença permanente, para cobrir o rent da licença pago pelo servidor. */
export const MIN_PERMANENT_PRICE_USDC = 5;
/** Usos do teste grátis quando o manifest do especialista não define trial.uses. */
export const FREE_TRIAL_USES = 3;

export function usdcToUnits(usdc: number): bigint {
  // Arredonda em centavos de micro-USDC para evitar erros de float (ex: 0.1 + 0.2).
  return BigInt(Math.round(usdc * 1_000_000));
}

export function unitsToUsdc(units: bigint | number): number {
  const u = BigInt(units);
  return Number(u / USDC_UNIT) + Number(u % USDC_UNIT) / 1_000_000;
}

export function bpsToScore(bps: number): number {
  return Math.round(bps) / 100;
}

export function scoreToBps(score: number): number {
  return Math.round(score * 100);
}

export function averageRating(ratingSum: number | bigint, ratingCount: number): number {
  if (!ratingCount) return 0;
  return Math.round((Number(ratingSum) / ratingCount) * 10) / 10;
}

export function reputationScore(purchases: number, disputesLost: number): number {
  const raw = 50 + Math.min(purchases, 20) * 1.5 - disputesLost * 15;
  return Math.max(0, Math.min(100, raw));
}

/** Compras necessárias para o nível completo de garantia. */
export const FULL_LEVEL_PURCHASES = 3;

export function guaranteeLevel(purchases: number, disputesLost: number): GuaranteeLevel {
  const score = reputationScore(purchases, disputesLost);
  if (disputesLost >= MAX_BUYER_DISPUTES_LOST || score < 30) return "none";
  if (purchases < FULL_LEVEL_PURCHASES) return "limited";
  return "full";
}

/**
 * Reputação do criador (0..100): cresce com vendas e boa nota, cai muito com disputas perdidas.
 * Mesma ideia da reputação do usuário (5.9), usando os dados do agente on-chain.
 */
export function creatorReputationScore(totalSales: number, avgRating: number, disputesLost: number): number {
  const ratingBonus = avgRating > 0 ? (avgRating - 3) * 5 : 0;
  const raw = 50 + Math.min(totalSales, 20) * 1.5 + ratingBonus - disputesLost * 15;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/** Valor máximo de garantia por nível, em USDC. */
export const GUARANTEE_LIMITS_USDC: Record<GuaranteeLevel, number> = {
  none: 0,
  limited: 20,
  full: 500,
};

/** Teto de disputes_lost aceito on-chain em create_escrow (espelha o programa). */
export const MAX_BUYER_DISPUTES_LOST = 3;

/** No nível limitado, garantias acima deste valor precisam de pelo menos 2 etapas. */
export const SINGLE_MILESTONE_MAX_USDC = 10;

/** Especialista sai da vitrine com nota abaixo de DELIST_MAX_RATING depois de DELIST_MIN_REVIEWS avaliações. */
export const DELIST_MIN_REVIEWS = 10;
export const DELIST_MAX_RATING = 3.5;

/** Divide o preço da garantia pelas etapas do modelo (% de cada uma); a última fica com o arredondamento. */
export function splitGuaranteeAmounts(totalUsdc: number, sharesPct: number[]): number[] {
  const total = usdcToUnits(totalUsdc);
  const sum = sharesPct.reduce((s, p) => s + p, 0);
  const units = sharesPct.map((p) => (total * BigInt(Math.round(p * 100))) / BigInt(Math.round(sum * 100)));
  const rest = total - units.reduce((s, u) => s + u, 0n);
  return units.map((u, i) => unitsToUsdc(i === units.length - 1 ? u + rest : u));
}

/** agent_id: 16 bytes em hex (32 caracteres). */
export function agentIdToBytes(id: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error(`agent id inválido: ${id}`);
  return Uint8Array.from(id.match(/../g)!.map((h) => parseInt(h, 16)));
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

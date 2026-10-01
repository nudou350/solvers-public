import {
  RESALE_ERROR_CODES,
  RESALE_ERROR_HTTP_STATUS,
  RESALE_MAX_CUT_BPS,
  unitsToUsdc,
  usdcToUnits,
  type ResaleErrorCode,
} from "@solvers/shared";
import { HttpError } from "../lib/http.js";

// Regras puras da revenda (sem env, banco nem RPC): testadas em test/resale-rules.test.ts.
// O programa é a autoridade final; estas regras só devolvem erros claros ANTES de montar e simular a transação.

/** Teto de sanidade do preço de anúncio (USDC): protege a conversão para unidades de 6 casas contra números absurdos. */
export const MAX_LISTING_PRICE_USDC = 1_000_000_000;

/** Quantas vendas recentes do solver entram na tendência de preço do anúncio. */
export const TREND_HISTORY_SIZE = 10;

/**
 * Preço em USDC digitado pelo usuário -> unidades (6 casas). Recusa não numérico, zero ou negativo, mais de 6 casas
 * decimais (nada de arredondar o preço do usuário em silêncio) e acima de `MAX_LISTING_PRICE_USDC`.
 * Com `minUnits`, recusa abaixo do mínimo da plataforma (`price_too_low`, igual ao programa).
 */
export function parseListingPrice(priceUsdc: number, minUnits?: bigint): bigint {
  const invalid = (msg: string) => new HttpError(400, msg, "validation");
  if (typeof priceUsdc !== "number" || !Number.isFinite(priceUsdc)) throw invalid("priceUsdc: informe um número");
  if (priceUsdc <= 0) throw invalid("priceUsdc: o preço precisa ser maior que zero");
  if (priceUsdc > MAX_LISTING_PRICE_USDC) throw invalid("priceUsdc: o preço informado é grande demais");
  // 6 casas é a precisão do USDC. Tolera só o ruído do ponto flutuante (1.1400000000000001 ecoado pelo cliente);
  // casas reais a mais (1.1234567) continuam recusadas, sem arredondar o preço do usuário em silêncio.
  const tolerance = 1e-9 + priceUsdc * 2e-16;
  if (Math.abs(priceUsdc - Math.round(priceUsdc * 1e6) / 1e6) > tolerance) throw invalid("priceUsdc: use no máximo 6 casas decimais");
  const units = usdcToUnits(priceUsdc);
  if (units <= 0n) throw invalid("priceUsdc: o preço precisa ser maior que zero");
  if (minUnits !== undefined && units < minUnits) {
    throw new HttpError(
      RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.priceTooLow],
      `O preço mínimo para anunciar é ${unitsToUsdc(minUnits)} USDC.`,
      RESALE_ERROR_CODES.priceTooLow,
      { minPriceUsdc: unitsToUsdc(minUnits) },
    );
  }
  return units;
}

/** Royalty do criador + taxa da plataforma não podem passar do teto (o vendedor fica com pelo menos metade). */
export function assertResaleCut(royaltyBps: number, feeBps: number): void {
  if (royaltyBps + feeBps > RESALE_MAX_CUT_BPS) {
    throw new HttpError(
      RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.cutTooHigh],
      "O royalty do criador somado à taxa da plataforma passa de 50% do preço: esta licença não pode ser anunciada agora.",
      RESALE_ERROR_CODES.cutTooHigh,
    );
  }
}

/**
 * Tendência de preço de um anúncio: quanto o preço pedido está acima (+) ou abaixo (-) da MÉDIA dos preços das últimas
 * vendas pelo mercado do mesmo solver (até `TREND_HISTORY_SIZE`, `soldPricesUnits` da mais recente para a mais antiga;
 * as mais velhas além do limite são ignoradas). Em %, com 1 casa. Sem vendas anteriores (ou média zero): 0, ou seja,
 * "sem referência", nunca um número inventado. `floorUnits` é o preço do anúncio (o piso quando é o mais barato).
 */
export function listingTrendPct(floorUnits: bigint, soldPricesUnits: readonly bigint[]): number {
  const recent = soldPricesUnits.slice(0, TREND_HISTORY_SIZE);
  if (recent.length === 0) return 0;
  const avg = Number(recent.reduce((s, p) => s + p, 0n)) / recent.length;
  if (!(avg > 0)) return 0;
  const pct = ((Number(floorUnits) - avg) / avg) * 100;
  return Math.round(pct * 10) / 10;
}

/** Erro de revenda lançado pelo `@solvers/chain` (`ResaleError`), visto pela forma (sem importar a classe). */
export type ResaleErrorLike = { name: string; message: string; code: ResaleErrorCode; details?: { priceUnits?: bigint } };

export function isResaleError(e: unknown): e is ResaleErrorLike {
  if (!(e instanceof Error) || e.name !== "ResaleError") return false;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code in RESALE_ERROR_HTTP_STATUS;
}

/**
 * `ResaleError` -> resposta HTTP do contrato (`{ error, code, ...extra }`, status de `RESALE_ERROR_HTTP_STATUS`).
 * `listing_changed` leva `priceUsdc` (o preço atual do anúncio) para o comprador confirmar o novo valor.
 */
export function resaleErrorToHttp(e: ResaleErrorLike): HttpError {
  const extra = e.code === RESALE_ERROR_CODES.listingChanged && e.details?.priceUnits !== undefined ? { priceUsdc: unitsToUsdc(e.details.priceUnits) } : undefined;
  return new HttpError(RESALE_ERROR_HTTP_STATUS[e.code], e.message, e.code, extra);
}

/** Roda uma montagem de transação da revenda e traduz `ResaleError` em `HttpError`; qualquer outro erro passa igual. */
export async function withResaleErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isResaleError(e)) throw resaleErrorToHttp(e);
    throw e;
  }
}

/** Anúncio ativo da licença é do próprio comprador? (a checagem on-chain `own_listing` roda de novo na montagem). */
export function isOwnListing(sellerWallet: string, buyerWallet: string): boolean {
  return sellerWallet === buyerWallet;
}

/**
 * Confere o anúncio lido on-chain contra o preço que o comprador viu (decisão pura; quem lê a cadeia é `assertFreshListing`).
 * - `gone`: a conta Listing não existe mais (vendido, cancelado ou refeito) -> 404 `listing_not_found`.
 * - `changed`: o preço on-chain é outro -> 409 `listing_changed` com o preço atual.
 */
export type FreshListingDecision = { kind: "ok" } | { kind: "gone" } | { kind: "changed"; priceUnits: bigint };

export function decideFreshListing(onchain: { price: bigint } | null, expectedUnits: bigint): FreshListingDecision {
  if (!onchain) return { kind: "gone" };
  if (onchain.price !== expectedUnits) return { kind: "changed", priceUnits: onchain.price };
  return { kind: "ok" };
}

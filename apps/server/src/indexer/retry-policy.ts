// Política de novas tentativas do indexador (funções puras, sem banco nem RPC).

/** A transação ainda não está visível no RPC (ou outra condição passageira): tenta de novo sem gastar tentativas. */
export class IndexerRetryableError extends Error {
  override name = "IndexerRetryableError";
}

/** Falhas que contam (não são de infraestrutura) até a assinatura ser dada como "dead". */
export const MAX_ATTEMPTS = 12;
/** Falha de infraestrutura que dura mais que isso também vira "dead" (a transação pode nunca aparecer). */
export const MAX_INFRA_AGE_DAYS = 7;
/** Espera fixa depois de uma falha de infraestrutura. */
export const INFRA_RETRY_SECS = 60;
const BASE_SECS = 30;
const CAP_SECS = 6 * 3600;

/** Backoff exponencial: 30 s, 1 min, 2 min, ... até 6 h. `attempts` é quantas falhas já contaram. */
export function backoffSecs(attempts: number): number {
  return Math.min(CAP_SECS, BASE_SECS * 2 ** Math.max(0, attempts - 1));
}

const INFRA_PATTERN =
  /fetch failed|econnreset|econnrefused|etimedout|enotfound|eai_again|socket hang up|timed out|timeout|network|\b(429|502|503|504)\b|too many requests|gateway|unhealthy|não visível|nao visivel|rate limit/i;

/**
 * Falha de infraestrutura (RPC fora do ar, limite de requisições, transação ainda não visível): não
 * reflete um problema da transação em si, então não gasta tentativas.
 */
export function isInfraError(e: unknown): boolean {
  if (e instanceof IndexerRetryableError) return true;
  const parts = [(e as Error)?.message, (e as { cause?: { message?: string } })?.cause?.message, (e as { code?: unknown })?.code]
    .filter((x) => x != null)
    .map(String);
  return INFRA_PATTERN.test(parts.join(" "));
}

import { env } from "../env.js";

// Cotação USD -> BRL para mostrar "equivalente em reais". USDC ~ USD.
// Cache de 1h; se a API pública falhar, usa BRL_PER_USD do env.

let cached: { rate: number; at: number } | null = null;
const TTL_MS = 3600_000;

export async function brlPerUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;
  try {
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", { signal: AbortSignal.timeout(3000) });
    const json = (await res.json()) as { USDBRL?: { bid?: string } };
    const rate = Number(json.USDBRL?.bid);
    if (Number.isFinite(rate) && rate > 1 && rate < 20) {
      cached = { rate, at: Date.now() };
      return rate;
    }
  } catch {
    /* usa o fallback */
  }
  cached = { rate: env.BRL_PER_USD, at: Date.now() - TTL_MS + 300_000 };
  return env.BRL_PER_USD;
}

import { z } from "zod";
import type { SodaxSource } from "@solvers/shared";
import { HttpError } from "../lib/http.js";

// Cotação real do SODAX (swap por intenção entre redes) para a opção de pagamento "SODAX" da demo.
// Só cotação: nada é assinado nem enviado (o SODAX não tem testnet; a execução real fica para a mainnet).
// A API só aceita `exact_input`, então o valor a pagar é calculado: cota um valor de referência, deriva a
// taxa de câmbio, dimensiona a entrada com folga e confere com uma segunda cotação.

const SOLANA_USDC = { chainKey: "solana", token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } as const;
const NATIVE = "0x0000000000000000000000000000000000000000";

interface Source extends SodaxSource {
  chainKey: string;
  token: string;
  decimals: number;
  /** Entrada de referência (unidades mínimas) usada para descobrir a taxa de câmbio. */
  ref: bigint;
}

const SOURCES: Source[] = [
  { key: "eth-base", label: "ETH na Base", network: "Base", symbol: "ETH", chainKey: "0x2105.base", token: NATIVE, decimals: 18, ref: 10n ** 16n },
  {
    key: "usdc-base",
    label: "USDC na Base",
    network: "Base",
    symbol: "USDC",
    chainKey: "0x2105.base",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    ref: 10_000_000n,
  },
  { key: "eth-arbitrum", label: "ETH na Arbitrum", network: "Arbitrum", symbol: "ETH", chainKey: "0xa4b1.arbitrum", token: NATIVE, decimals: 18, ref: 10n ** 16n },
  {
    key: "usdc-arbitrum",
    label: "USDC na Arbitrum",
    network: "Arbitrum",
    symbol: "USDC",
    chainKey: "0xa4b1.arbitrum",
    token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    ref: 10_000_000n,
  },
];

export const sodaxSources = (): SodaxSource[] => SOURCES.map(({ key, label, network, symbol }) => ({ key, label, network, symbol }));

/** O SODAX recusa entradas abaixo de ~US$ 1 (erro -23): cotamos pelo menos isto. */
export const MIN_TARGET_UNITS = 1_010_000n;
/** Folga sobre a taxa de referência (taxa do SODAX + variação entre a cotação de referência e a final). */
const MARGIN = 1.004;
const TTL_MS = 20_000;
const TIMEOUT_MS = 5_000;

const QuoteResponse = z.object({ quotedAmount: z.string().regex(/^\d+$/) });

export interface SodaxClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface TargetQuote {
  source: SodaxSource;
  /** Entrada em unidades mínimas da origem e em decimal. */
  payUnits: bigint;
  payAmount: number;
  /** USDC (6 casas) que o SODAX entregaria. */
  receiveUnits: bigint;
  minApplied: boolean;
  quotedAt: number;
}

/** Entrada que, à taxa `rate` (USDC mínimos por unidade mínima de origem), rende `target` com folga. */
export function sizeInput(target: bigint, rate: number, margin = MARGIN): bigint {
  if (!(rate > 0)) throw new Error("taxa inválida");
  return BigInt(Math.ceil((Number(target) / rate) * margin));
}

const unavailable = (msg = "Não foi possível consultar o SODAX agora. Tente de novo em instantes.") =>
  new HttpError(502, msg, "sodax_unavailable");

export function createSodaxClient({ baseUrl, fetchImpl = fetch, now = Date.now }: SodaxClientOptions) {
  const refRates = new Map<string, { rate: number; at: number }>();
  const quotes = new Map<string, { value: TargetQuote; at: number }>();

  async function quoteExactInput(src: Source, amount: bigint): Promise<bigint> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenSrc: src.token,
          tokenSrcChainKey: src.chainKey,
          tokenDst: SOLANA_USDC.token,
          tokenDstChainKey: SOLANA_USDC.chainKey,
          amount: amount.toString(),
          quoteType: "exact_input",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw unavailable();
    }
    if (res.status === 429) throw new HttpError(503, "O SODAX está recebendo muitas consultas. Tente de novo em instantes.", "sodax_rate_limited");
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("[sodax] cotação recusada", res.status, JSON.stringify(json)?.slice(0, 200));
      throw unavailable();
    }
    const parsed = QuoteResponse.safeParse(json);
    if (!parsed.success) {
      console.error("[sodax] resposta inesperada", JSON.stringify(json)?.slice(0, 200));
      throw unavailable();
    }
    return BigInt(parsed.data.quotedAmount);
  }

  async function refRate(src: Source): Promise<number> {
    const hit = refRates.get(src.key);
    if (hit && now() - hit.at < TTL_MS) return hit.rate;
    const out = await quoteExactInput(src, src.ref);
    if (out <= 0n) throw unavailable();
    const rate = Number(out) / Number(src.ref);
    refRates.set(src.key, { rate, at: now() });
    return rate;
  }

  /** Cotação para receber `need` USDC (unidades de 6 casas) na Solana pagando em `sourceKey`. */
  async function quoteForTarget(sourceKey: string, need: bigint): Promise<TargetQuote> {
    const src = SOURCES.find((s) => s.key === sourceKey);
    if (!src) throw new HttpError(400, "Forma de pagamento SODAX desconhecida.", "sodax_source");
    const minApplied = need < MIN_TARGET_UNITS;
    const target = minApplied ? MIN_TARGET_UNITS : need;

    const cacheKey = `${src.key}:${target}`;
    const hit = quotes.get(cacheKey);
    if (hit && now() - hit.at < TTL_MS) return { ...hit.value, minApplied };

    let payUnits = sizeInput(target, await refRate(src));
    let receive = await quoteExactInput(src, payUnits);
    if (receive < target && receive > 0n) {
      // Cotação final abaixo do esperado (preço mexeu ou o valor pesa na liquidez): reajusta uma vez.
      payUnits = BigInt(Math.ceil((Number(payUnits) * Number(target)) / Number(receive) * 1.002));
      receive = await quoteExactInput(src, payUnits);
    }
    if (receive < target) throw unavailable("O SODAX não conseguiu cotar este valor agora. Tente de novo em instantes.");

    const value: TargetQuote = {
      source: { key: src.key, label: src.label, network: src.network, symbol: src.symbol },
      payUnits,
      payAmount: Number(payUnits) / 10 ** src.decimals,
      receiveUnits: receive,
      minApplied,
      quotedAt: now(),
    };
    if (quotes.size > 200) quotes.clear();
    quotes.set(cacheKey, { value, at: now() });
    return value;
  }

  return { quoteForTarget, sources: sodaxSources };
}

export type SodaxClient = ReturnType<typeof createSodaxClient>;

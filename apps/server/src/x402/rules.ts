// Regras puras da compra por x402 (docs/x402-agentes.md, seção 6): sem env, banco nem rede, para testar de forma isolada.

export type OrderStatus = "created" | "settling" | "paid" | "minting" | "minted" | "refunding" | "refunded" | "failed" | "expired";

export const ORDER_STATUSES: readonly OrderStatus[] = ["created", "settling", "paid", "minting", "minted", "refunding", "refunded", "failed", "expired"];

/** Estados finais: nada mais acontece com a ordem. */
export const TERMINAL: readonly OrderStatus[] = ["minted", "refunded", "failed", "expired"];

/**
 * Transições permitidas. O que muda dinheiro de mão só avança:
 * - created -> settling: o pagamento foi conferido e a ordem reservada (um pagamento por ordem).
 * - settling -> created: o settle falhou de forma conclusiva (nada saiu da carteira do agente) e a ordem ainda vale.
 * - settling -> paid: liquidado. settling -> expired/failed: o reconciliador provou que o pagamento não entrou.
 * - paid -> minting -> minted: emissão. minting -> paid: a transação gravada não entrou (conclusivo) e vai ser refeita.
 * - paid/minting -> refunding -> refunded: a emissão não é possível (ou provadamente não entrou): devolve o USDC.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  created: ["settling", "expired"],
  settling: ["created", "paid", "expired", "failed"],
  paid: ["minting", "refunding"],
  minting: ["minted", "paid", "refunding"],
  minted: [],
  refunding: ["refunded"],
  refunded: [],
  failed: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isOrderStatus(v: string): v is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(v);
}

/** Estados em que o USDC do agente já está (ou pode estar) na custódia: precisam de desfecho (licença ou reembolso). */
export const MONEY_IN_CUSTODY: readonly OrderStatus[] = ["settling", "paid", "minting", "refunding"];

// ---------- Preço ----------

export const USDC_DECIMALS = 6;

/** USDC (número da configuração) -> unidades de 6 casas, sem erro de ponto flutuante. */
export function usdcToAtomic(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error("invalid USDC amount");
  return BigInt(Math.round(usdc * 10 ** USDC_DECIMALS));
}

/** Piso e teto da rota em unidades. O piso nunca fica abaixo do `min_price` do programa (lido da Config on-chain). */
export function priceBounds(cfg: { minUsdc: number; maxUsdc: number }, programMinPrice: bigint): { min: bigint; max: bigint } {
  const envMin = usdcToAtomic(cfg.minUsdc);
  return { min: envMin > programMinPrice ? envMin : programMinPrice, max: usdcToAtomic(cfg.maxUsdc) };
}

export function priceInBounds(price: bigint, b: { min: bigint; max: bigint }): boolean {
  return price >= b.min && price <= b.max;
}

// ---------- Requisitos ----------

/** O que o servidor exige no pagamento de uma ordem (a verdade vem do banco, nunca do cliente). */
export type OrderRequirements = {
  scheme: "exact";
  network: string;
  /** Unidades atômicas do USDC, em texto. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer: string; memo: string };
};

export function buildRequirements(input: {
  orderId: string;
  price: bigint;
  network: string;
  usdcMint: string;
  custody: string;
  feePayer: string;
  maxTimeoutSeconds?: number;
}): OrderRequirements {
  return {
    scheme: "exact",
    network: input.network,
    amount: input.price.toString(),
    asset: input.usdcMint,
    payTo: input.custody,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 60,
    extra: { feePayer: input.feePayer, memo: input.orderId },
  };
}

/** Lê o `memo` (id da ordem) do que o agente devolveu como `accepted`. `null` se não houver um texto utilizável. */
export function memoOf(accepted: { extra?: unknown } | null | undefined): string | null {
  const extra = accepted?.extra;
  if (!extra || typeof extra !== "object") return null;
  const memo = (extra as { memo?: unknown }).memo;
  return typeof memo === "string" && /^ord_[0-9a-f]{24}$/.test(memo) ? memo : null;
}

/**
 * Igualdade EXATA entre o `accepted` do pagamento e o que a ordem exige (conferir `>=` não basta: o agente poderia
 * trocar rede, moeda ou destino). Devolve o nome do primeiro campo diferente, ou `null` se tudo bate.
 * `feePayer` não entra: quem o confere é o facilitator (a transação tem de ter o fee payer dele).
 */
export function requirementsMismatch(
  accepted: { scheme?: unknown; network?: unknown; amount?: unknown; asset?: unknown; payTo?: unknown; extra?: unknown } | null | undefined,
  required: Pick<OrderRequirements, "scheme" | "network" | "amount" | "asset" | "payTo" | "extra">,
): string | null {
  if (!accepted || typeof accepted !== "object") return "accepted";
  if (accepted.scheme !== required.scheme) return "scheme";
  if (accepted.network !== required.network) return "network";
  if (accepted.asset !== required.asset) return "asset";
  if (accepted.payTo !== required.payTo) return "payTo";
  if (accepted.amount !== required.amount) return "amount";
  if (memoOf(accepted) !== required.extra.memo) return "memo";
  return null;
}

// ---------- Tempo ----------

export function orderExpired(order: { expiresAt: Date }, now: Date = new Date()): boolean {
  return order.expiresAt.getTime() <= now.getTime();
}

/** Segundos parada em um estado a partir dos quais o reconciliador assume a ordem. */
export const STALE_SECS = 120;

// ---------- Falha do settle ----------

export type SettleOutcome = "settled" | "failed" | "ambiguous";

/**
 * Classifica a resposta do `settle`. Só "failed" devolve a ordem a `created` (o dinheiro não saiu).
 * Se o facilitator citou uma transação mesmo falhando, ou lançou erro (timeout, rede), pode ter entrado: "ambiguous".
 */
export function classifySettle(r: { success: boolean; transaction?: string } | { thrown: true }): SettleOutcome {
  if ("thrown" in r) return "ambiguous";
  if (r.success) return "settled";
  return r.transaction ? "ambiguous" : "failed";
}

// ---------- Reembolso ----------

export type MintOutcome = "confirmed" | "failed" | "expired" | "pending" | "unsent";

/**
 * O que fazer com uma ordem cuja emissão não terminou, dado o desfecho da transação de emissão gravada.
 * Só reembolsa quando é CERTO que a licença não vai ser emitida: uma transação que ainda pode entrar nunca é reembolsada
 * (o agente receberia a licença e o dinheiro de volta).
 * - ownedByPayer: a licença já está na carteira do pagador (qualquer que seja o desfecho): a ordem está cumprida.
 */
export function decideStalledMint(input: { outcome: MintOutcome; ownedByPayer: boolean; paidAgeSecs: number }): "fulfilled" | "resume" | "retry" | "refund" {
  if (input.ownedByPayer || input.outcome === "confirmed") return "fulfilled";
  if (input.outcome === "pending") return "resume";
  // Nunca assinada/enviada: nada pode ter entrado, então tentar de novo é seguro; passado o prazo, devolve o dinheiro.
  if (input.outcome === "unsent" && input.paidAgeSecs < MINT_RETRY_WINDOW_SECS) return "retry";
  return "refund";
}

/** Por quanto tempo (a partir do pagamento) a emissão pode ser refeita antes de reembolsar. */
export const MINT_RETRY_WINDOW_SECS = 600;

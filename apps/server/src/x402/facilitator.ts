import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { env } from "../env.js";

// Ponte com o facilitator do x402 (confere o pagamento, paga a taxa de rede e envia a transação). Atrás de uma interface
// pequena para os testes trocarem por um falso e para o `settle` ter a classificação certa (ver `classifySettle`).

export type VerifyResult = { isValid: boolean; payer?: string; reason?: string };
export type SettleResult = { success: boolean; payer?: string; transaction?: string; reason?: string };

export interface Facilitator {
  /** Carteira que o facilitator usa como pagadora da taxa (vai em `extra.feePayer` do 402). */
  feePayer(network: string): Promise<string>;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  /** Lança em erro de rede/timeout: o chamador trata como resultado ambíguo (o pagamento pode ter entrado). */
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}

const FEE_PAYER_TTL_MS = 10 * 60_000;

export function httpFacilitator(url: string): Facilitator {
  const client = new HTTPFacilitatorClient({ url });
  let cached: { network: string; feePayer: string; at: number } | null = null;
  return {
    async feePayer(network) {
      if (cached && cached.network === network && Date.now() - cached.at < FEE_PAYER_TTL_MS) return cached.feePayer;
      const supported = await client.getSupported();
      const kind = supported.kinds.find((k) => k.x402Version === 2 && k.scheme === "exact" && k.network === network);
      const feePayer = (kind?.extra as { feePayer?: unknown } | undefined)?.feePayer;
      if (typeof feePayer !== "string" || !feePayer) throw new Error(`o facilitator não suporta ${network} (exact)`);
      cached = { network, feePayer, at: Date.now() };
      return feePayer;
    },
    async verify(payload, requirements) {
      const r = await client.verify(payload, requirements);
      return { isValid: r.isValid, payer: r.payer, reason: r.invalidReason ?? r.invalidMessage };
    },
    async settle(payload, requirements) {
      const r = await client.settle(payload, requirements);
      return { success: r.success, payer: r.payer, transaction: r.transaction || undefined, reason: r.errorReason ?? r.errorMessage };
    },
  };
}

let _facilitator: Facilitator | null = null;

export function facilitator(): Facilitator {
  return (_facilitator ??= httpFacilitator(env.X402_FACILITATOR_URL));
}

/** Só para testes. */
export function setFacilitator(f: Facilitator | null) {
  _facilitator = f;
}

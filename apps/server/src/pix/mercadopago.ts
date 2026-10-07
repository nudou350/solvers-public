import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";

// Mercado Pago, API Orders (Pix). fetch direto, sem SDK.
// Docs: developers.mercadopago.com > Checkout API (Orders) > Pix, status de order e notificações.

const BASE = "https://api.mercadopago.com";

export type MpOrder = {
  id: string;
  status: string; // action_required | processing | processed | expired | canceled | failed | refunded | charged_back
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  transactions?: {
    payments?: {
      id?: string;
      status?: string;
      expiration_time?: string;
      date_of_expiration?: string;
      payment_method?: { id?: string; type?: string; qr_code?: string; qr_code_base64?: string; ticket_url?: string };
    }[];
  };
};

async function mp<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  if (!env.MP_ACCESS_TOKEN) throw new HttpError(503, "Mercado Pago is not configured", "pix_unavailable");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      "content-type": "application/json",
      ...(init.idempotencyKey ? { "x-idempotency-key": init.idempotencyKey } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; errors?: unknown };
  if (!res.ok) {
    console.error("[mercadopago]", init.method ?? "GET", path, res.status, JSON.stringify(body).slice(0, 500));
    throw new HttpError(502, "Mercado Pago declined the Pix charge. Please try again in a moment.", "pix_provider_error");
  }
  return body;
}

const brl = (cents: number) => (cents / 100).toFixed(2);

export function createPixOrder(input: { externalReference: string; amountCents: number; email: string; firstName: string }) {
  const amount = brl(input.amountCents);
  return mp<MpOrder>("/v1/orders", {
    method: "POST",
    idempotencyKey: input.externalReference,
    body: JSON.stringify({
      type: "online",
      external_reference: input.externalReference,
      total_amount: amount,
      processing_mode: "automatic",
      transactions: {
        payments: [{ amount, payment_method: { id: "pix", type: "bank_transfer" }, expiration_time: "PT30M" }],
      },
      // No modo teste, first_name "APRO" faz o Pix ser aprovado sozinho.
      payer: { email: input.email, first_name: env.MP_TEST_MODE ? "APRO" : input.firstName },
    }),
  });
}

export const getOrder = (id: string) => mp<MpOrder>(`/v1/orders/${encodeURIComponent(id)}`);

export function orderPayment(order: MpOrder) {
  const p = order.transactions?.payments?.[0];
  return {
    qrCode: p?.payment_method?.qr_code ?? null,
    qrBase64: p?.payment_method?.qr_code_base64 ?? null,
    ticketUrl: p?.payment_method?.ticket_url ?? null,
  };
}

/**
 * Valida o header x-signature ("ts=...,v1=...") de um webhook do Mercado Pago.
 * Manifest: "id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;" (pares ausentes são omitidos),
 * HMAC-SHA256 em hex com MP_WEBHOOK_SECRET, comparado em tempo constante.
 */
export function verifyWebhookSignature(opts: {
  signature: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  secret: string | undefined;
}): boolean {
  if (!opts.secret || !opts.signature) return false;
  const parts = new Map(
    opts.signature.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k!.trim(), v.join("=").trim()] as const;
    }),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  let manifest = "";
  if (opts.dataId) manifest += `id:${opts.dataId.toLowerCase()};`;
  if (opts.requestId) manifest += `request-id:${opts.requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", opts.secret).update(manifest).digest();
  return timingSafeEqual(expected, Buffer.from(v1, "hex"));
}

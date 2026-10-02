import { Router, type Request, type Response } from "express";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { unitsToUsdc } from "@solvers/shared";
import { chain } from "../chain/index.js";
import { env } from "../env.js";
import { HttpError, badRequest, h, notFound } from "../lib/http.js";
import { agentIsAvailable } from "../runtime/availability.js";
import { findAgentRow } from "../store/catalog.js";
import { assertFreshPrice } from "../store/fresh-price.js";
import { assertEntriesOpen } from "../store/pause-gate.js";
import { assertSupplyOpen } from "../store/supply.js";
import { isRowSoldOut } from "../store/supply-rules.js";
import { assertCanPurchase } from "../store/purchase-guards.js";
import { facilitator } from "./facilitator.js";
import { fulfilOrder } from "./mint.js";
import { countOpenOrders, createOrder, getOrder, move, type OrderRow } from "./orders.js";
import { buildRequirements, classifySettle, memoOf, orderExpired, priceBounds, priceInBounds, requirementsMismatch, type OrderRequirements } from "./rules.js";

// Compra de licença por x402 (docs/x402-agentes.md, seção 6.4). Fluxo `upfront`: o pagamento é liquidado ANTES de emitir a licença.
//
//   POST /api/x402/solvers/:idOrSlug/license
//     sem PAYMENT-SIGNATURE -> cria a ordem (preço travado) e responde 402 com PAYMENT-REQUIRED (memo = id da ordem)
//     com PAYMENT-SIGNATURE -> confere, liquida (verify + settle), emite a licença para QUEM PAGOU e responde 200
//   GET  /api/x402/solvers/:idOrSlug   cotação pública, sem criar ordem
//   GET  /api/x402/orders/:id          estado de uma ordem (para quem recebeu 202)
//
// A custódia só paga (i) o `purchase_license` de uma ordem paga e (ii) o reembolso ao pagador da própria ordem. Nenhuma rota
// recebe endereço de destino do cliente: o NFT vai sempre para o pagador que o facilitator confirmou.

export const x402Router = Router();

const NO_STORE = "no-store, private";
const ORDER_ID = /^ord_[0-9a-f]{24}$/;

function setup(): { custody: string; usdcMint: string; network: string } {
  const custody = chain().custodyAddress;
  if (!env.X402_ENABLED || !custody) throw new HttpError(503, "Compra por x402 indisponível.", "x402_disabled");
  return { custody, usdcMint: chain().usdcMint, network: env.X402_NETWORK };
}

/** Piso e teto da rota. O piso nunca fica abaixo do `min_price` do programa (Config on-chain). */
async function bounds() {
  const cfg = await chain().fetchConfig();
  return priceBounds({ minUsdc: env.X402_MIN_PRICE_USDC, maxUsdc: env.X402_MAX_PRICE_USDC }, cfg.data.minPrice);
}

type AgentRow = Awaited<ReturnType<typeof findAgentRow>>;

/** O agente existe, está à venda e o preço é o on-chain atual (espelha e responde 409 se mudou). */
async function sellableAgent(idOrSlug: string): Promise<AgentRow> {
  const row = await findAgentRow(idOrSlug);
  if (!agentIsAvailable(row)) throw new HttpError(409, "Este especialista não está disponível para compra no momento.", "agent_unavailable");
  await assertFreshPrice(row);
  // Teto de licenças atingido: 409 sold_out ANTES de qualquer ordem ou cobrança (o programa também recusaria, mas aí o agente já teria pago).
  assertSupplyOpen(row, { resaleEnabled: env.RESALE_ENABLED });
  return row;
}

function requirementsOf(order: OrderRow, feePayer: string): OrderRequirements {
  const s = setup();
  return buildRequirements({ orderId: order.id, price: order.price, network: s.network, usdcMint: s.usdcMint, custody: s.custody, feePayer });
}

function paymentRequired(order: OrderRow, row: AgentRow, reqs: OrderRequirements, error: string): PaymentRequired {
  return {
    x402Version: 2,
    error,
    resource: {
      url: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/x402/solvers/${row.id}/license`,
      description: `Licença vitalícia do Solver ${row.name}`,
      mimeType: "application/json",
    },
    accepts: [reqs as unknown as PaymentRequirements],
  };
}

/** 402 com o mesmo JSON no cabeçalho (base64) e no corpo. */
function send402(res: Response, body: PaymentRequired) {
  res.setHeader("Cache-Control", NO_STORE);
  res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body));
  res.status(402).json(body);
}

function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

// ---------- Cotação ----------

x402Router.get(
  "/x402/solvers/:idOrSlug",
  h(async (req, res) => {
    const s = setup();
    res.setHeader("Cache-Control", "no-store");
    let row = await findAgentRow(String(req.params.idOrSlug));
    try {
      await assertFreshPrice(row);
    } catch (e) {
      // O preço mudou: assertFreshPrice já espelhou o agente; a cotação mostra o novo valor em vez de errar.
      if (e instanceof HttpError && e.code === "price_changed") row = await findAgentRow(row.id);
      else throw e;
    }
    const b = await bounds();
    const available = agentIsAvailable(row);
    const soldOut = isRowSoldOut(row);
    const inBounds = priceInBounds(row.price, b);
    return {
      agentId: row.id,
      slug: row.slug,
      name: row.name,
      priceUsdc: String(unitsToUsdc(row.price)),
      available: available && inBounds && !soldOut,
      reason: !available ? "agent_unavailable" : soldOut ? "sold_out" : !inBounds ? "price_out_of_range" : undefined,
      limitsUsdc: { min: String(unitsToUsdc(b.min)), max: String(unitsToUsdc(b.max)) },
      network: s.network,
      asset: s.usdcMint,
      payTo: s.custody,
      endpoint: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/x402/solvers/${row.id}/license`,
    };
  }),
);

// ---------- Estado da ordem ----------

x402Router.get(
  "/x402/orders/:id",
  h(async (req, res) => {
    setup();
    res.setHeader("Cache-Control", NO_STORE);
    const id = String(req.params.id);
    const order = ORDER_ID.test(id) ? await getOrder(id) : null;
    if (!order) throw notFound("Ordem não encontrada");
    return {
      orderId: order.id,
      status: order.status,
      agentId: order.agentId,
      priceUsdc: String(unitsToUsdc(order.price)),
      owner: order.payer,
      asset: order.status === "minted" ? order.asset : null,
      paymentSignature: order.paySignature,
      mintSignature: order.status === "minted" ? order.mintSignature : null,
      refundSignature: order.refundSignature,
      refunded: order.status === "refunded",
    };
  }),
);

// ---------- Compra ----------

x402Router.post(
  "/x402/solvers/:idOrSlug/license",
  h(async (req, res) => {
    setup();
    const header = req.header("payment-signature");
    return header ? pay(req, res, header) : openOrder(req, res);
  }),
);

/** (a) Sem pagamento: cria a ordem com o preço travado e responde 402. */
async function openOrder(req: Request, res: Response) {
  const s = setup();
  await assertEntriesOpen("x402"); // pausa de emergência: 503 antes de qualquer ordem
  const row = await sellableAgent(String(req.params.idOrSlug));
  const b = await bounds();
  if (!priceInBounds(row.price, b)) {
    throw badRequest("O preço deste especialista está fora dos limites da compra por x402.", "price_out_of_range", {
      priceUsdc: String(unitsToUsdc(row.price)),
      minUsdc: String(unitsToUsdc(b.min)),
      maxUsdc: String(unitsToUsdc(b.max)),
    });
  }
  const ip = clientIp(req);
  if (ip && (await countOpenOrders(ip)) >= env.X402_MAX_OPEN_ORDERS_PER_IP) {
    throw new HttpError(429, "Muitas ordens abertas. Pague uma delas ou aguarde o vencimento.", "too_many_open_orders");
  }
  const feePayer = await facilitator().feePayer(s.network);
  const order = await createOrder({ agentId: row.id, price: row.price, ttlSecs: env.X402_ORDER_TTL_SECS, clientIp: ip });
  send402(res, paymentRequired(order, row, requirementsOf(order, feePayer), "payment_required"));
  return undefined;
}

/** (b) Com pagamento: confere, liquida e emite a licença para o pagador. */
async function pay(req: Request, res: Response, header: string) {
  const s = setup();
  res.setHeader("Cache-Control", NO_STORE);

  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    throw badRequest("PAYMENT-SIGNATURE inválido.", "invalid_payment");
  }
  const orderId = memoOf(payload.accepted);
  if (!orderId) throw badRequest("O pagamento não referencia uma ordem (memo).", "order_invalid");

  await assertEntriesOpen("x402");

  // 1) A ordem precisa existir, estar aberta e valer.
  let order = await getOrder(orderId);
  if (!order) throw new HttpError(409, "Ordem não encontrada. Peça uma nova.", "order_invalid");
  if (order.status !== "created") {
    if (order.status === "minted") {
      throw new HttpError(409, "Esta ordem já foi paga e a licença emitida.", "order_already_fulfilled", { orderId, asset: order.asset, owner: order.payer });
    }
    if (order.status === "expired" || order.status === "failed" || order.status === "refunded") {
      throw new HttpError(409, "Esta ordem não vale mais. Peça uma nova.", "order_invalid", { status: order.status });
    }
    throw new HttpError(409, "Esta ordem já está sendo processada. Consulte o estado dela.", "order_in_progress", { orderId, status: order.status });
  }
  if (orderExpired(order)) {
    await move(orderId, "created", "expired");
    throw new HttpError(409, "A ordem venceu. Peça uma nova.", "order_expired");
  }
  const row = await findAgentRow(order.agentId);
  if (!agentIsAvailable(row)) throw new HttpError(409, "Este especialista não está disponível para compra no momento.", "agent_unavailable");
  // O teto pode ter sido atingido depois de a ordem abrir: barra antes de verify/settle (ninguém paga por uma licença que não sai).
  assertSupplyOpen(row, { resaleEnabled: env.RESALE_ENABLED });

  // 2) O que o agente aceitou tem de ser EXATAMENTE o que a ordem exige; o facilitator confere contra a nossa versão, não a dele.
  const feePayer = await facilitator().feePayer(s.network);
  const reqs = requirementsOf(order, feePayer);
  const mismatch = requirementsMismatch(payload.accepted, reqs);
  if (mismatch) throw badRequest("O pagamento não corresponde à ordem.", "payment_mismatch", { field: mismatch });

  // 3) Preço travado vs. on-chain: se o criador mudou o preço depois da ordem, pagar levaria a falha na emissão.
  const onchain = await chain().fetchMaybeAgent(order.agentId);
  if (!onchain.exists || onchain.data.price !== order.price) {
    await move(orderId, "created", "expired");
    throw new HttpError(409, "O preço deste especialista mudou. Peça uma nova ordem.", "price_changed", {
      priceUsdc: onchain.exists ? String(unitsToUsdc(onchain.data.price)) : undefined,
    });
  }

  // 4) Confere o pagamento (nada é liquidado ainda).
  let verified;
  try {
    verified = await facilitator().verify(payload, reqs as unknown as PaymentRequirements);
  } catch (e) {
    console.error("[x402] verify indisponível:", (e as Error).message);
    throw new HttpError(502, "Não foi possível conferir o pagamento agora. Tente de novo.", "facilitator_unavailable");
  }
  if (!verified.isValid || !verified.payer) {
    send402(res, paymentRequired(order, row, reqs, verified.reason ?? "invalid_payment"));
    return undefined;
  }
  const payer = verified.payer;

  // 5) Guardas com o pagador, ANTES de liquidar: quem não pode comprar não perde dinheiro.
  if (payer === s.custody || payer === chain().feePayer.address) throw badRequest("Esta carteira não pode comprar.", "payer_not_allowed");
  await assertCanPurchase(payer, row); // already_owned (409) / creator_cannot_buy (400)

  // 6) Reserva atômica: um pagamento por ordem. Quem perde não liquida nada.
  const claimed = await move(orderId, "created", "settling", { payer });
  if (!claimed) throw new HttpError(409, "Esta ordem já está sendo processada.", "order_in_use");
  order = claimed;

  // 7) Liquida.
  let settled: Awaited<ReturnType<ReturnType<typeof facilitator>["settle"]>> | null = null;
  try {
    settled = await facilitator().settle(payload, reqs as unknown as PaymentRequirements);
  } catch (e) {
    console.error(`[x402] settle sem resposta (ordem ${orderId}):`, (e as Error).message);
  }
  const outcome = classifySettle(settled ?? { thrown: true });
  if (outcome === "failed") {
    // Conclusivo: nada saiu da carteira do agente. A ordem volta a valer (se ainda vigente) para ele pagar de novo.
    await move(orderId, "settling", orderExpired(order) ? "expired" : "created");
    send402(res, paymentRequired(order, row, reqs, settled?.reason ?? "settle_failed"));
    return undefined;
  }
  if (outcome === "ambiguous" || !settled?.transaction) {
    // Pode ter entrado: a ordem fica `settling` e a reconciliação decide pela cadeia. O agente consulta o estado.
    res.status(202).json({ code: "payment_pending", error: "Pagamento em confirmação. Consulte o estado da ordem.", orderId, status: "settling" });
    return undefined;
  }
  if (settled.payer && settled.payer !== payer) {
    console.error(`[x402][ALERTA] ordem ${orderId}: pagador do settle (${settled.payer}) diferente do verificado (${payer})`);
  }
  const paySignature = settled.transaction;
  let paid: OrderRow | null;
  try {
    paid = await move(orderId, "settling", "paid", { paySignature });
  } catch (e) {
    // A assinatura é única no banco: o mesmo pagamento já pertence a outra ordem. Nada é emitido; fica para revisão manual.
    console.error(`[x402][ALERTA] ordem ${orderId}: pagamento ${paySignature} já registrado em outra ordem`, (e as Error).message);
    throw new HttpError(409, "Este pagamento já foi usado em outra ordem.", "duplicate_payment");
  }
  if (!paid) throw new HttpError(409, "Esta ordem já está sendo processada.", "order_in_use");

  // 8) Emite a licença (ou reembolsa se não for possível).
  const result = await fulfilOrder(orderId);
  if (result.status === "minted") {
    res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader({ success: true, transaction: paySignature, network: s.network as `${string}:${string}`, payer }));
    return {
      agentId: order.agentId,
      asset: result.asset,
      owner: payer,
      paymentSignature: paySignature,
      mintSignature: result.mintSignature,
      next: "activate_solver",
    };
  }
  if (result.status === "refunded") {
    res.status(502).json({
      error: "Não foi possível emitir a licença. O pagamento foi devolvido.",
      code: "mint_failed",
      refunded: true,
      refundSignature: result.refundSignature,
      orderId,
    });
    return undefined;
  }
  res.status(202).json({ code: "mint_pending", error: "Pagamento recebido. A licença está sendo emitida; consulte o estado da ordem.", orderId, status: "minting" });
  return undefined;
}

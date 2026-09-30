import { Router } from "express";
import { randomBytes } from "node:crypto";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { address } from "@solvers/chain";
import { unitsToUsdc, usdcToUnits, type PixCharge, type PixConfig } from "@solvers/shared";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { chain, explorerUrl } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { badRequest, h, HttpError, notFound, parse, unauthorized } from "../lib/http.js";
import { findAgentRow, guaranteeOffer } from "../store/catalog.js";
import { brlPerUsd } from "../store/fx.js";
import { assertFreshPrice } from "../store/fresh-price.js";
import { ensureProfile } from "../store/profile.js";
import { credit, markApproved } from "./credit.js";
import { createPixOrder, getOrder, orderPayment, verifyWebhookSignature } from "./mercadopago.js";

// Pix na demo (FRONT_PLAN.md, Fase B): o comprador paga Pix e recebe USDC de TESTE na carteira,
// emitido pelo servidor (faucet). Não há dinheiro real nem conversão real. Na mainnet fica desativado.

const MIN_CENTS = 100; // R$ 1
const MAX_CENTS = 50_000; // R$ 500
const MAX_PENDING = 3;
const TTL_MS = 30 * 60_000; // PT30M, igual à expiração pedida ao Mercado Pago

type Row = typeof schema.pixCharges.$inferSelect;

const isMainnet = () => env.SOLANA_CLUSTER === "mainnet-beta";

export function pixConfig(): PixConfig {
  const provider = env.MP_ACCESS_TOKEN ? "mercadopago" : env.PIX_SIMULATE ? "simulated" : null;
  return {
    enabled: !isMainnet() && provider !== null,
    simulate: env.PIX_SIMULATE,
    provider: isMainnet() ? null : provider,
    minBrl: MIN_CENTS / 100,
    maxBrl: MAX_CENTS / 100,
  };
}

function toPixCharge(r: Row): PixCharge {
  return {
    id: r.id,
    provider: r.provider as PixCharge["provider"],
    // "crediting" é interno (emissão em andamento): para o cliente segue "approved" até virar "credited".
    status: (r.status === "crediting" ? "approved" : r.status) as PixCharge["status"],
    amountBrl: r.amountBrl / 100,
    amountUsdc: unitsToUsdc(r.amountUsdc),
    qrCode: r.qrCode,
    qrCodeBase64: r.qrBase64,
    ticketUrl: r.ticketUrl,
    expiresAt: r.expiresAt.toISOString(),
    // A assinatura é gravada antes do envio: só é exposta depois que o crédito se confirma.
    creditSignature: r.status === "credited" ? r.creditSignature : null,
    explorerUrl: r.status === "credited" && r.creditSignature ? explorerUrl("tx", r.creditSignature) : null,
    // Cobranças antigas de créditos (pagamento por uso acabou) saem sem purpose.
    purpose: r.purpose && (r.purpose.type as string) !== "credits" ? r.purpose : null,
    simulated: r.provider === "simulated",
    createdAt: r.createdAt.toISOString(),
  };
}

async function load(id: string): Promise<Row | undefined> {
  const [row] = await db.select().from(schema.pixCharges).where(eq(schema.pixCharges.id, id));
  return row;
}

// O crédito (assinar -> gravar -> enviar -> reconciliar) está em ./credit.ts.

/** Atualiza a cobrança pelo provedor (nunca pelo corpo do webhook) e credita se estiver paga. */
async function sync(row: Row): Promise<Row> {
  if (row.status === "credited") return row;
  // "crediting": a emissão já foi iniciada; quem conclui é o job de reconciliação (pela transação gravada).
  if (row.status === "crediting") return row;
  if (row.status === "approved") {
    await credit(row.id).catch((e) => console.error("[pix] crédito falhou", row.id, e));
    return (await load(row.id))!;
  }
  if (row.provider === "mercadopago" && row.providerOrderId && env.MP_ACCESS_TOKEN) {
    const order = await getOrder(row.providerOrderId);
    if (order.external_reference && order.external_reference !== row.externalReference) {
      console.error("[pix] order com external_reference diferente", row.id, order.id);
      return row;
    }
    if (order.status === "processed") {
      await markApproved(row.id);
      await credit(row.id).catch((e) => console.error("[pix] crédito falhou", row.id, e));
    } else if (row.status === "pending" && (order.status === "expired" || order.status === "canceled" || order.status === "failed")) {
      await db
        .update(schema.pixCharges)
        .set({ status: order.status === "failed" ? "failed" : "expired", updatedAt: new Date() })
        .where(and(eq(schema.pixCharges.id, row.id), eq(schema.pixCharges.status, "pending")));
    }
    return (await load(row.id))!;
  }
  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    await db
      .update(schema.pixCharges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(schema.pixCharges.id, row.id), eq(schema.pixCharges.status, "pending")));
    return (await load(row.id))!;
  }
  return row;
}

/** Quanto falta (em unidades de USDC) para a compra pretendida, descontando o saldo da carteira. */
async function neededUnits(wallet: string, agentId: string, type: "permanent" | "guarantee"): Promise<bigint> {
  const row = await findAgentRow(agentId);
  if (row.status !== "active") throw badRequest("Este especialista ainda não está disponível para compra.");
  let total: bigint;
  if (type === "permanent") {
    // O preço pode ter mudado on-chain sem evento: confere antes de cobrar o Pix do valor antigo.
    await assertFreshPrice(row);
    total = row.price;
  }
  else {
    const offer = guaranteeOffer(row, 1);
    if (!offer) throw badRequest("Este especialista não oferece tarefa com garantia.");
    total = usdcToUnits(offer.priceUsdc);
  }
  const balance = await chain().usdcBalance(address(wallet));
  return total > balance ? total - balance : 0n;
}

export const pixRouter = Router();

pixRouter.post(
  "/pix/charges",
  requireAuth,
  h(async (req): Promise<PixCharge> => {
    if (isMainnet()) {
      throw badRequest("Pix não está disponível na mainnet: aqui ele só existe na demo, com USDC de teste.", "pix_unavailable");
    }
    const cfg = pixConfig();
    if (!cfg.enabled) throw badRequest("Pix não está configurado neste servidor.", "pix_unavailable");
    const wallet = requireWallet(req);
    const body = parse(
      z.union([
        z.object({ usdc: z.number().positive().max(1_000) }).strict(),
        z.object({ agentId: z.string().min(1).max(100), type: z.enum(["permanent", "guarantee"]) }).strict(),
      ]),
      req.body,
    );

    const rate = await brlPerUsd();
    let units: bigint;
    let purpose: Row["purpose"] = null;
    if ("usdc" in body) {
      units = usdcToUnits(body.usdc);
    } else {
      units = await neededUnits(wallet, body.agentId, body.type);
      if (units === 0n) throw badRequest("Você já tem saldo suficiente para esta compra.", "balance_sufficient");
      purpose = { agentId: (await findAgentRow(body.agentId)).id, type: body.type };
    }
    // Centavo mais próximo, igual ao total que a vitrine mostra (units tem 6 casas: centavos = units * cotação / 10^4).
    // O USDC creditado é sempre o valor exato; a diferença de meio centavo fica por conta da plataforma.
    let cents = Math.round(Number(units) * rate / 10_000);
    if (cents < MIN_CENTS) {
      if ("usdc" in body) throw badRequest(`O valor mínimo do Pix é R$ ${(MIN_CENTS / 100).toFixed(2)}.`, "pix_min");
      // Falta pouco para a compra: cobra o mínimo e credita o equivalente (um pouco mais que o necessário).
      cents = MIN_CENTS;
      units = BigInt(Math.floor((MIN_CENTS * 10_000) / rate));
    }
    if (cents > MAX_CENTS) throw badRequest(`O valor máximo por Pix é R$ ${(MAX_CENTS / 100).toFixed(2)}.`, "pix_max");

    // Expira as pendentes vencidas e limita as abertas por carteira.
    await db
      .update(schema.pixCharges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(schema.pixCharges.wallet, wallet), eq(schema.pixCharges.status, "pending"), lt(schema.pixCharges.expiresAt, new Date())));
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.pixCharges)
      .where(and(eq(schema.pixCharges.wallet, wallet), eq(schema.pixCharges.status, "pending"), gt(schema.pixCharges.expiresAt, new Date())));
    if (n >= MAX_PENDING) {
      throw new HttpError(429, `Você já tem ${MAX_PENDING} cobranças Pix em aberto. Pague ou espere expirarem.`, "pix_pending_limit");
    }

    const id = `pix_${randomBytes(12).toString("hex")}`;
    const provider = cfg.provider!;
    const [created] = await db
      .insert(schema.pixCharges)
      .values({
        id,
        wallet,
        provider,
        externalReference: `solvers-${id}`,
        amountBrl: cents,
        amountUsdc: units,
        expiresAt: new Date(Date.now() + TTL_MS),
        purpose,
        // Modo simulado: copia e cola fictício, que não pode ser pago em banco nenhum.
        qrCode: provider === "simulated" ? `PIX-DE-TESTE-SOLVERS|NAO-PAGAR|SIMULADO|${id}|R$${(cents / 100).toFixed(2)}` : null,
      })
      .returning();
    if (provider === "simulated") return toPixCharge(created!);

    const profile = await ensureProfile(wallet);
    try {
      const order = await createPixOrder({
        externalReference: created!.externalReference,
        amountCents: cents,
        email: profile.email ?? `pix-${wallet.slice(0, 8).toLowerCase()}@solvers.wondervelop.com`,
        firstName: profile.displayName?.split(" ")[0] ?? "Cliente",
      });
      const pay = orderPayment(order);
      const [row] = await db
        .update(schema.pixCharges)
        .set({ providerOrderId: order.id, qrCode: pay.qrCode, qrBase64: pay.qrBase64, ticketUrl: pay.ticketUrl, updatedAt: new Date() })
        .where(eq(schema.pixCharges.id, id))
        .returning();
      return toPixCharge(row!);
    } catch (e) {
      await db.update(schema.pixCharges).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.pixCharges.id, id));
      throw e;
    }
  }),
);

async function ownCharge(wallet: string, id: string): Promise<Row> {
  const row = await load(id);
  if (!row || row.wallet !== wallet) throw notFound("Cobrança Pix não encontrada");
  return row;
}

pixRouter.get(
  "/pix/charges/:id",
  requireAuth,
  h(async (req): Promise<PixCharge> => {
    const row = await ownCharge(requireWallet(req), String(req.params.id));
    return toPixCharge(await sync(row).catch(() => row));
  }),
);

pixRouter.post(
  "/pix/charges/:id/simulate",
  requireAuth,
  h(async (req): Promise<PixCharge> => {
    if (isMainnet() || !env.PIX_SIMULATE) throw badRequest("Simulação de pagamento desativada neste servidor.", "pix_simulate_disabled");
    const row = await ownCharge(requireWallet(req), String(req.params.id));
    if (row.status === "failed") throw badRequest("Esta cobrança falhou; crie outra.", "pix_failed");
    if (row.status === "expired" || (row.status === "pending" && row.expiresAt.getTime() < Date.now())) {
      throw badRequest("Esta cobrança expirou; crie outra.", "pix_expired");
    }
    await markApproved(row.id);
    await credit(row.id);
    return toPixCharge((await load(row.id))!);
  }),
);

// ---------- Webhook (sem auth de sessão; autenticado pela assinatura) ----------

export const pixWebhookRouter = Router();

pixWebhookRouter.post(
  "/mercadopago",
  h(async (req) => {
    const q = req.query as Record<string, unknown>;
    const body = (req.body ?? {}) as { type?: string; action?: string; data?: { id?: unknown } };
    const queryId = typeof q["data.id"] === "string" ? (q["data.id"] as string) : undefined;
    const ok = verifyWebhookSignature({
      signature: req.get("x-signature"),
      requestId: req.get("x-request-id"),
      dataId: queryId,
      secret: env.MP_WEBHOOK_SECRET,
    });
    if (!ok) throw unauthorized("assinatura do webhook inválida");
    // Só usamos o id (coberto pela assinatura quando vem na query); o estado vem do GET da order.
    const orderId = queryId ?? (typeof body.data?.id === "string" ? body.data.id : undefined);
    const type = (typeof q.type === "string" ? q.type : undefined) ?? body.type;
    if (!orderId || (type && type !== "order")) return { ok: true, ignored: true };
    const [row] = await db
      .select()
      .from(schema.pixCharges)
      .where(sql`lower(${schema.pixCharges.providerOrderId}) = ${orderId.toLowerCase()}`);
    if (!row) return { ok: true, ignored: true };
    // Erro aqui devolve 500 e o Mercado Pago tenta de novo mais tarde.
    const updated = await sync(row);
    return { ok: true, status: updated.status };
  }),
);

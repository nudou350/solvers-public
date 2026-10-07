import { Router } from "express";
import { randomBytes } from "node:crypto";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { unitsToUsdc, type PixCharge, type SodaxConfig, type SodaxQuote } from "@solvers/shared";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { badRequest, h, HttpError, parse } from "../lib/http.js";
import { credit, markApproved } from "../pix/credit.js";
import { load, MAX_PENDING, neededUnits, ownCharge, toPixCharge, TTL_MS } from "../pix/routes.js";
import { findAgentRow } from "../store/catalog.js";
import { brlPerUsd } from "../store/fx.js";
import { createSodaxClient, MIN_TARGET_UNITS, sodaxSources } from "./client.js";

// Opção de pagamento "SODAX" na demo: cotação REAL do SODAX e pagamento SIMULADO que credita USDC de teste
// (mesma cobrança e mesmo crédito do Pix simulado, em `pix_charges` com provider = "sodax"). Nenhum dinheiro
// real é movido. A execução real do swap exige mainnet, que o SODAX tem e a demo (devnet) não.

const isMainnet = () => env.SOLANA_CLUSTER === "mainnet-beta";

export function sodaxConfig(): SodaxConfig {
  return { enabled: !isMainnet() && env.SODAX_SIMULATE, simulate: env.SODAX_SIMULATE, sources: sodaxSources() };
}

const client = createSodaxClient({ baseUrl: env.SODAX_API_URL });

function assertEnabled() {
  if (!sodaxConfig().enabled) throw badRequest("Paying with SODAX is only available in the demo.", "sodax_unavailable");
}

const Purchase = z
  .object({ agentId: z.string().min(1).max(100), type: z.enum(["permanent", "guarantee"]), source: z.string().min(1).max(40) })
  .strict();

export const sodaxRouter = Router();

sodaxRouter.get(
  "/sodax/quote",
  requireAuth,
  h(async (req): Promise<SodaxQuote> => {
    assertEnabled();
    const wallet = requireWallet(req);
    const q = parse(
      z.object({ agentId: z.string().min(1).max(100), type: z.enum(["permanent", "guarantee"]), source: z.string().min(1).max(40) }),
      req.query,
    );
    const need = await neededUnits(wallet, q.agentId, q.type);
    if (need === 0n) throw badRequest("You already have enough balance for this purchase.", "balance_sufficient");
    const quote = await client.quoteForTarget(q.source, need);
    return {
      source: quote.source,
      payAmount: quote.payAmount,
      receiveUsdc: unitsToUsdc(quote.receiveUnits),
      needUsdc: unitsToUsdc(need),
      minApplied: quote.minApplied,
      quotedAt: new Date(quote.quotedAt).toISOString(),
    };
  }),
);

sodaxRouter.post(
  "/sodax/charges",
  requireAuth,
  h(async (req): Promise<PixCharge> => {
    assertEnabled();
    const wallet = requireWallet(req);
    const body = parse(Purchase, req.body);
    if (!sodaxSources().some((s) => s.key === body.source)) throw badRequest("Unknown SODAX payment method.", "sodax_source");

    const need = await neededUnits(wallet, body.agentId, body.type);
    if (need === 0n) throw badRequest("You already have enough balance for this purchase.", "balance_sufficient");
    // Falta pouco: credita o mínimo que o SODAX aceita (um pouco mais que o necessário), como o Pix faz.
    const units = need < MIN_TARGET_UNITS ? MIN_TARGET_UNITS : need;
    const rate = await brlPerUsd();
    const cents = Math.round((Number(units) * rate) / 10_000);

    await db
      .update(schema.pixCharges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(schema.pixCharges.wallet, wallet), eq(schema.pixCharges.status, "pending"), lt(schema.pixCharges.expiresAt, new Date())));
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.pixCharges)
      .where(and(eq(schema.pixCharges.wallet, wallet), eq(schema.pixCharges.status, "pending"), gt(schema.pixCharges.expiresAt, new Date())));
    if (n >= MAX_PENDING) {
      throw new HttpError(429, `You already have ${MAX_PENDING} open charges. Pay them or wait for them to expire.`, "pix_pending_limit");
    }

    const id = `pix_${randomBytes(12).toString("hex")}`;
    const [created] = await db
      .insert(schema.pixCharges)
      .values({
        id,
        wallet,
        provider: "sodax",
        externalReference: `solvers-${id}`,
        amountBrl: cents,
        amountUsdc: units,
        expiresAt: new Date(Date.now() + TTL_MS),
        purpose: { agentId: (await findAgentRow(body.agentId)).id, type: body.type },
      })
      .returning();
    return toPixCharge(created!);
  }),
);

/** Pagamento de teste: aprova a cobrança sem mover dinheiro e credita o USDC de teste. */
sodaxRouter.post(
  "/sodax/charges/:id/simulate",
  requireAuth,
  h(async (req): Promise<PixCharge> => {
    if (isMainnet() || !env.SODAX_SIMULATE) throw badRequest("Test payments are disabled on this server.", "sodax_simulate_disabled");
    const row = await ownCharge(requireWallet(req), String(req.params.id));
    if (row.provider !== "sodax") throw badRequest("This charge is not from SODAX.", "sodax_charge");
    if (row.status === "failed") throw badRequest("This charge failed; create a new one.", "pix_failed");
    if (row.status === "expired" || (row.status === "pending" && row.expiresAt.getTime() < Date.now())) {
      throw badRequest("This charge expired; create a new one.", "pix_expired");
    }
    await markApproved(row.id);
    await credit(row.id);
    return toPixCharge((await load(row.id))!);
  }),
);

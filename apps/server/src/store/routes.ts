import { Router } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { address, type Address } from "@solvers/chain";
import { FREE_TRIAL_USES, MIN_PERMANENT_PRICE_USDC, unitsToUsdc, usdcToUnits, type License, type Profile, type TxResponse } from "@solvers/shared";
import { chain, explorerUrl } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { processSignature } from "../indexer/processor.js";
import { brlPerUsd } from "./fx.js";
import type { Signature } from "@solvers/chain";
import { refreshLicenseOwner } from "../indexer/sync.js";
import { searchAgentRows } from "../knowledge/search.js";
import { badRequest, h, HttpError, parse } from "../lib/http.js";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import {
  findAgentRow,
  getAgentDetail,
  getCreator,
  getCreatorProfile,
  listAgents,
  listCategories,
  listReviews,
  mapAgents,
} from "./catalog.js";
import { creditsToLicense, toLicense, toReputation } from "./mappers.js";

export const storeRouter = Router();

// ---------- Público ----------

storeRouter.get(
  "/config",
  h(async () => {
    const c = chain();
    const config = await c.fetchConfig().catch(() => null);
    return {
      cluster: env.SOLANA_CLUSTER,
      rpcUrl: env.SOLANA_CLUSTER === "localnet" ? env.SOLANA_RPC_URL : null,
      programId: c.programId,
      usdcMint: c.usdcMint,
      feePayer: c.feePayer.address,
      feeBps: config?.data.feeBps ?? null,
      minPurchaseUsdc: config ? unitsToUsdc(config.data.minPrice) : MIN_PERMANENT_PRICE_USDC,
      faucetEnabled: env.FAUCET_ENABLED,
      brlPerUsd: await brlPerUsd(),
      faucetAmountUsdc: env.FAUCET_AMOUNT_USDC,
      connectorUrl: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/mcp`,
    };
  }),
);

storeRouter.get(
  "/agents",
  h(async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(200).optional(),
        category: z.string().max(60).optional(),
        sort: z.enum(["rating", "uses", "trend", "new"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      req.query,
    );
    return listAgents(q);
  }),
);

storeRouter.get("/categories", h(async () => listCategories()));

storeRouter.get(
  "/agents/:idOrSlug/metadata.json",
  h(async (req) => {
    const row = await findAgentRow(String(req.params.idOrSlug));
    // JSON público apontado por metadata_uri (padrão de metadados de NFT).
    return {
      name: row.name,
      symbol: "SOLVER",
      description: row.tagline,
      external_url: `${env.PUBLIC_WEB_URL.replace(/\/$/, "")}/especialistas/${row.slug}`,
      attributes: [
        { trait_type: "agent_id", value: row.id },
        { trait_type: "category", value: row.category },
        { trait_type: "version", value: row.version },
      ],
    };
  }),
);

storeRouter.get(
  "/agents/:idOrSlug/reviews",
  h(async (req) => {
    const row = await findAgentRow(String(req.params.idOrSlug));
    return listReviews(row.id, 200);
  }),
);

storeRouter.get("/agents/:idOrSlug", h(async (req) => getAgentDetail(String(req.params.idOrSlug))));

storeRouter.post(
  "/search",
  h(async (req) => {
    const { need } = parse(z.object({ need: z.string().min(3).max(500) }), req.body);
    return mapAgents(await searchAgentRows(need, 3));
  }),
);

storeRouter.get("/creators/:id", h(async (req) => getCreatorProfile(String(req.params.id))));

/** Mercado de revenda (P2): anúncios de licenças. Na demo os anúncios e o histórico são simulados. */
storeRouter.get(
  "/market/listings",
  h(async () => {
    const rows = await db.select().from(schema.licenses).where(eq(schema.licenses.listedForResale, true)).orderBy(schema.licenses.resalePrice);
    const agentRows = await Promise.all([...new Set(rows.map((r) => r.agentId))].map((id) => findAgentRow(id)));
    const agents = new Map((await mapAgents(agentRows)).map((a) => [a.id, a]));
    const out = [];
    for (const r of rows) {
      const agent = agents.get(r.agentId);
      if (!agent || r.resalePrice == null) continue;
      const hist = await db
        .select()
        .from(schema.resalePrices)
        .where(eq(schema.resalePrices.agentId, r.agentId))
        .orderBy(desc(schema.resalePrices.at))
        .limit(10);
      const last = hist[0] ? unitsToUsdc(hist[0].price) : null;
      const prev = hist[hist.length - 1] ? unitsToUsdc(hist[hist.length - 1]!.price) : null;
      out.push({
        license: toLicense(r),
        agent,
        priceUsdc: unitsToUsdc(r.resalePrice),
        priceTrendPct: last && prev ? Math.round(((last - prev) / prev) * 1000) / 10 : 0,
        simulated: true,
      });
    }
    return out;
  }),
);

// ---------- Autenticado ----------

storeRouter.get(
  "/me/licenses",
  requireAuth,
  h(async (req): Promise<License[]> => {
    const wallet = requireWallet(req);
    const lic = await db.select().from(schema.licenses).where(eq(schema.licenses.ownerWallet, wallet)).orderBy(desc(schema.licenses.acquiredAt));
    const cred = await db
      .select()
      .from(schema.credits)
      .where(and(eq(schema.credits.ownerWallet, wallet), gt(schema.credits.purchased, 0)));
    return [...lic.map(toLicense), ...cred.map(creditsToLicense)];
  }),
);

storeRouter.post(
  "/me/licenses/refresh",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const lic = await db.select().from(schema.licenses).where(eq(schema.licenses.ownerWallet, wallet));
    for (const l of lic) await refreshLicenseOwner(l.id);
    return { ok: true };
  }),
);

storeRouter.get(
  "/me/reputation",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const [row] = await db.select().from(schema.userReputation).where(eq(schema.userReputation.wallet, wallet));
    return toReputation(wallet, row);
  }),
);

const KIND_LABEL: Record<string, string> = {
  purchase: "Compra de licença",
  credits: "Compra de créditos",
  review: "Avaliação publicada",
  escrow: "Tarefa com garantia criada",
  milestone: "Etapa de garantia atualizada",
  dispute_resolved: "Contestação resolvida",
};

storeRouter.get(
  "/me/profile",
  requireAuth,
  h(async (req): Promise<Profile> => {
    const wallet = requireWallet(req);
    const [rep] = await db.select().from(schema.userReputation).where(eq(schema.userReputation.wallet, wallet));
    const [creatorRow] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, wallet));
    const txs = await db.select().from(schema.chainTxs).where(eq(schema.chainTxs.wallet, wallet)).orderBy(desc(schema.chainTxs.createdAt)).limit(30);
    return {
      wallet,
      reputation: toReputation(wallet, rep),
      creator: creatorRow ? await getCreator(creatorRow.id) : null,
      explorerUrl: explorerUrl("address", wallet),
      history: txs.map((t) => ({
        kind: t.kind,
        label: KIND_LABEL[t.kind] ?? t.kind,
        at: t.createdAt.toISOString(),
        signature: t.signature,
      })),
    };
  }),
);

storeRouter.get(
  "/me/balance",
  requireAuth,
  h(async (req) => {
    const wallet = address(requireWallet(req));
    return { usdc: unitsToUsdc(await chain().usdcBalance(wallet)) };
  }),
);

/** Uso de cada especialista pela carteira (biblioteca). */
storeRouter.get(
  "/me/usage",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const rows = await db
      .select({
        agentId: schema.usageEvents.agentId,
        activations: sql<number>`count(*) filter (where ${schema.usageEvents.tool} = 'activate_solver')`.mapWith(Number),
        calls: sql<number>`count(*)`.mapWith(Number),
        lastUsedAt: sql<string>`max(${schema.usageEvents.createdAt})`,
      })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.wallet, wallet))
      .groupBy(schema.usageEvents.agentId);
    return rows.filter((r) => r.agentId).map((r) => ({ ...r, lastUsedAt: new Date(r.lastUsedAt).toISOString() }));
  }),
);

/** Como a carteira acessa um especialista agora (licença, créditos ou teste grátis restante). */
storeRouter.get(
  "/me/access/:idOrSlug",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const row = await findAgentRow(String(req.params.idOrSlug));
    const [lic] = await db.select().from(schema.licenses).where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, row.id)));
    const [cred] = await db.select().from(schema.credits).where(and(eq(schema.credits.ownerWallet, wallet), eq(schema.credits.agentId, row.id)));
    const [trial] = await db.select().from(schema.trials).where(and(eq(schema.trials.wallet, wallet), eq(schema.trials.agentId, row.id)));
    return {
      agentId: row.id,
      license: lic ? lic.id : null,
      creditsLeft: cred?.remaining ?? null,
      trialUsesLeft: Math.max(0, FREE_TRIAL_USES - (trial?.used ?? 0)),
    };
  }),
);

// ---------- Transações ----------

async function assertBalance(wallet: Address, needed: bigint) {
  const balance = await chain().usdcBalance(wallet);
  if (balance < needed) {
    throw new HttpError(400, "Saldo de USDC insuficiente", "insufficient_funds", {
      balanceUsdc: unitsToUsdc(balance),
      neededUsdc: unitsToUsdc(needed),
      faucetEnabled: env.FAUCET_ENABLED,
    });
  }
}

storeRouter.post(
  "/tx/purchase",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = address(requireWallet(req));
    const body = parse(
      z.object({
        agentId: z.string(),
        type: z.enum(["permanent", "credits"]).default("permanent"),
        amount: z.number().int().min(1).max(10_000).optional(),
      }),
      req.body,
    );
    const row = await findAgentRow(body.agentId);
    if (row.status !== "active") throw badRequest("Este especialista ainda não está disponível para compra.");
    const c = chain();
    if (body.type === "permanent") {
      await assertBalance(wallet, row.price);
      const { instructions, asset, price } = await c.purchaseLicenseIxs(wallet, row.id, row.price);
      return c.buildForUser(instructions, { kind: "purchase", asset: asset.address, priceUsdc: unitsToUsdc(price), agentId: row.id });
    }
    if (row.pricePerUse <= 0n) throw badRequest("Este especialista não tem pagamento por uso.");
    const config = await c.fetchConfig();
    const minAmount = Number((config.data.minPrice + row.pricePerUse - 1n) / row.pricePerUse);
    const amount = Math.max(body.amount ?? minAmount, minAmount);
    const total = row.pricePerUse * BigInt(amount);
    await assertBalance(wallet, total);
    const instructions = await c.buyCreditsIxs(wallet, row.id, amount, total);
    return c.buildForUser(instructions, { kind: "credits", amount, totalUsdc: unitsToUsdc(total), agentId: row.id });
  }),
);

storeRouter.post(
  "/tx/submit",
  requireAuth,
  h(async (req, res) => {
    const { transaction } = parse(z.object({ transaction: z.string().min(100).max(2000) }), req.body);
    let signature: string;
    try {
      ({ signature } = await chain().submitSigned(transaction));
    } catch (e) {
      // Mesmo formato do contrato (SubmitResponse), com HTTP 422 para o front tratar como erro.
      res.status(422);
      return { signature: "", status: "failed", error: (e as Error).message };
    }
    // Indexa na hora: a licença aparece para o conector sem esperar webhook/polling.
    const events = await processSignature(signature).catch(() => []);
    return { signature, status: "confirmed", events: events.map((e) => e.name), explorerUrl: explorerUrl("tx", signature) };
  }),
);

/** Confirma uma transação enviada direto pela carteira (signAndSend) e indexa. */
storeRouter.post(
  "/tx/confirm",
  requireAuth,
  h(async (req, res) => {
    const { signature } = parse(z.object({ signature: z.string().min(60).max(100) }), req.body);
    const tx = await chain().txLogs(signature as Signature);
    if (!tx) {
      res.status(202);
      return { signature, status: "failed", error: "Transação ainda não encontrada; tente de novo em alguns segundos" };
    }
    if (tx.failed) return { signature, status: "failed", error: "Transação falhou na rede" };
    const events = await processSignature(signature).catch(() => []);
    return { signature, status: "confirmed", events: events.map((e) => e.name) };
  }),
);

// ---------- Faucet de USDC de teste ----------

const FAUCET_DAILY_CAP = 200;

/**
 * Reserva atômica de uma chave de cooldown: só uma requisição por janela consegue gravar.
 * Retorna false se ainda está no cooldown.
 */
async function claimCooldown(key: string, windowSecs: number): Promise<boolean> {
  const rows = await db
    .insert(schema.kv)
    .values({ key, value: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.kv.key,
      set: { value: new Date().toISOString(), updatedAt: new Date() },
      setWhere: sql`${schema.kv.updatedAt} < now() - make_interval(secs => ${windowSecs})`,
    })
    .returning();
  return rows.length > 0;
}

async function faucetDailyCount(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .insert(schema.kv)
    .values({ key: `faucet:day:${day}`, value: 1 })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value: sql`to_jsonb((${schema.kv.value})::text::int + 1)`, updatedAt: new Date() } })
    .returning();
  return Number(row?.value ?? 0);
}

storeRouter.post(
  "/faucet",
  requireAuth,
  h(async (req) => {
    if (!env.FAUCET_ENABLED) throw badRequest("Faucet desativado nesta rede");
    const wallet = address(requireWallet(req));
    // Cooldown por carteira e por IP (carteiras novas são grátis de criar).
    if (!(await claimCooldown(`faucet:w:${wallet}`, 3600))) {
      throw new HttpError(429, "Você já recebeu USDC de teste há pouco. Tente de novo em 1 hora.", "faucet_cooldown");
    }
    if (!(await claimCooldown(`faucet:ip:${req.ip}`, 600))) {
      throw new HttpError(429, "Muitos pedidos de USDC de teste desta rede. Tente de novo em 10 minutos.", "faucet_cooldown");
    }
    if ((await faucetDailyCount()) > FAUCET_DAILY_CAP) {
      throw new HttpError(429, "O faucet atingiu o limite de hoje.", "faucet_daily_cap");
    }
    const signature = await chain().faucet(wallet, usdcToUnits(env.FAUCET_AMOUNT_USDC));
    return { signature, amountUsdc: env.FAUCET_AMOUNT_USDC, explorerUrl: explorerUrl("tx", signature) };
  }),
);

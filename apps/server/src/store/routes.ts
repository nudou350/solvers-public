import { Router } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { address, TxError, type Address } from "@solvers/chain";
import {
  FREE_TRIAL_USES,
  GUARANTEE_LIMITS_USDC,
  MIN_PERMANENT_PRICE_USDC,
  unitsToUsdc,
  usdcToUnits,
  type AgentAccess,
  type License,
  type MyTrial,
  type Profile,
  type PublicConfig,
  type TxResponse,
  type UsageSummary,
} from "@solvers/shared";
import { chain, explorerUrl } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { processSignature } from "../indexer/processor.js";
import { assertFreshPrice } from "./fresh-price.js";
import { brlPerUsd } from "./fx.js";
import { pixConfig } from "../pix/routes.js";
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
  listCreators,
  listReviews,
  mapAgents,
} from "./catalog.js";
import { toLicense, toReputation } from "./mappers.js";
import { trialUsage } from "../runtime/access.js";
import { agentIsAvailable } from "../runtime/availability.js";
import { getPackage } from "../runtime/packages.js";
import { myTrial, trialLeft, trialLimits } from "../runtime/trial.js";
import { ensureProfile } from "./profile.js";

import { buildForUserChecked } from "./tx-build.js";
export const storeRouter = Router();

// ---------- Público ----------

storeRouter.get(
  "/config",
  h(async (): Promise<PublicConfig> => {
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
      freeTrialUses: FREE_TRIAL_USES,
      reviewWindowSecs: env.ESCROW_REVIEW_WINDOW_SECS,
      guaranteeLimitsUsdc: GUARANTEE_LIMITS_USDC,
      guaranteeMinSales: env.GUARANTEE_MIN_SALES,
      guaranteeMinRating: env.GUARANTEE_MIN_RATING,
      pix: pixConfig(),
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

storeRouter.get("/creators", h(async () => listCreators()));

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
    return lic.map(toLicense);
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
    const profile = await ensureProfile(wallet);
    const txs = await db.select().from(schema.chainTxs).where(eq(schema.chainTxs.wallet, wallet)).orderBy(desc(sql`coalesce(${schema.chainTxs.blockTime}, ${schema.chainTxs.createdAt})`)).limit(30);
    return {
      wallet,
      displayName: profile.displayName,
      email: profile.email,
      memberSince: profile.createdAt.toISOString(),
      reputation: toReputation(wallet, rep),
      creator: creatorRow ? await getCreator(creatorRow.id) : null,
      explorerUrl: explorerUrl("address", wallet),
      history: txs.map((t) => ({
        kind: t.kind,
        label: KIND_LABEL[t.kind] ?? t.kind,
        // Horário do bloco; created_at é só o momento em que o indexador viu a transação.
        at: (t.blockTime ?? t.createdAt).toISOString(),
        signature: t.signature,
      })),
    };
  }),
);

/** Nome e e-mail do perfil (o front envia os dados do login por e-mail). */
storeRouter.patch(
  "/me/profile",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(80).nullable().optional(),
        email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
      }),
      req.body,
    );
    await ensureProfile(wallet);
    await db
      .update(schema.userProfiles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.userProfiles.wallet, wallet));
    return { ok: true };
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

/** Uso de cada especialista pela carteira (biblioteca): totais, mês atual e 8 semanas. */
storeRouter.get(
  "/me/usage",
  requireAuth,
  h(async (req): Promise<UsageSummary[]> => {
    const wallet = requireWallet(req);
    const act = sql`${schema.usageEvents.tool} = 'activate_solver'`;
    const rows = await db
      .select({
        agentId: schema.usageEvents.agentId,
        activations: sql<number>`count(*) filter (where ${act})`.mapWith(Number),
        calls: sql<number>`count(*)`.mapWith(Number),
        lastUsedAt: sql<string>`max(${schema.usageEvents.createdAt})`,
        usesThisMonth: sql<number>`count(*) filter (where ${act} and ${schema.usageEvents.createdAt} >= date_trunc('month', now()))`.mapWith(Number),
      })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.wallet, wallet))
      .groupBy(schema.usageEvents.agentId);
    // Ativações por semana (0 = semana atual ... 7 = sete semanas atrás).
    const weeks = await db
      .select({
        agentId: schema.usageEvents.agentId,
        ago: sql<number>`((date_trunc('week', now())::date - date_trunc('week', ${schema.usageEvents.createdAt})::date) / 7)`.mapWith(Number),
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.usageEvents)
      .where(and(eq(schema.usageEvents.wallet, wallet), act, gt(schema.usageEvents.createdAt, sql`date_trunc('week', now()) - interval '7 weeks'`)))
      .groupBy(sql`1`, sql`2`);
    const weekly = (agentId: string) => {
      const out = [0, 0, 0, 0, 0, 0, 0, 0];
      for (const w of weeks) if (w.agentId === agentId && w.ago >= 0 && w.ago < 8) out[7 - w.ago] = w.n;
      return out;
    };
    return rows.flatMap((r) =>
      r.agentId
        ? [
            {
              agentId: r.agentId,
              activations: r.activations,
              calls: r.calls,
              lastUsedAt: new Date(r.lastUsedAt).toISOString(),
              usesThisMonth: r.usesThisMonth,
              weekly: weekly(r.agentId),
            },
          ]
        : [],
    );
  }),
);

/** Como a carteira acessa um especialista agora (licença ou saldo do teste grátis). */
storeRouter.get(
  "/me/access/:idOrSlug",
  requireAuth,
  h(async (req): Promise<AgentAccess> => {
    const wallet = requireWallet(req);
    const row = await findAgentRow(String(req.params.idOrSlug));
    const [lic] = await db.select().from(schema.licenses).where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, row.id)));
    const pkg = getPackage(row.id);
    const limits = pkg ? trialLimits(pkg.manifest) : null;
    if (!limits) return { agentId: row.id, license: lic ? lic.id : null, trialUsesLeft: 0, trial: null };
    const { used, usage } = await trialUsage(wallet, row.id);
    return {
      agentId: row.id,
      license: lic ? lic.id : null,
      trialUsesLeft: Math.max(0, limits.uses - used),
      trial: trialLeft(limits, usage),
    };
  }),
);

/** Testes grátis em andamento da carteira (biblioteca): só especialistas já ativados e ainda sem licença. */
storeRouter.get(
  "/me/trials",
  requireAuth,
  h(async (req): Promise<MyTrial[]> => {
    const wallet = requireWallet(req);
    const rows = await db.select().from(schema.trials).where(eq(schema.trials.wallet, wallet)).orderBy(desc(schema.trials.updatedAt));
    if (!rows.length) return [];
    const owned = await db.select({ agentId: schema.licenses.agentId }).from(schema.licenses).where(eq(schema.licenses.ownerWallet, wallet));
    const licensed = new Set(owned.map((l) => l.agentId));
    return rows.flatMap((r) => {
      const pkg = getPackage(r.agentId);
      const limits = pkg ? trialLimits(pkg.manifest) : null;
      if (!limits || licensed.has(r.agentId) || r.used <= 0) return [];
      return [myTrial(r.agentId, limits, r.used, { searchesUsed: r.searchesUsed, toolRuns: r.toolRuns }, r.updatedAt)];
    });
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
    // Só licença vitalícia: o pagamento por uso (type "credits") acabou e é recusado com 400.
    const body = parse(z.object({ agentId: z.string(), type: z.literal("permanent").default("permanent") }), req.body);
    const row = await findAgentRow(body.agentId);
    // Suspenso pela plataforma (platformStatus) também não vende: a coluna `status` é só o espelho da cadeia.
    if (!agentIsAvailable(row)) throw badRequest("Este especialista não está disponível para compra no momento.", "agent_unavailable");
    // update_pricing não emite evento: confere o preço on-chain e, se mudou, espelha e responde 409 price_changed.
    await assertFreshPrice(row);
    const c = chain();
    await assertBalance(wallet, row.price);
    const { instructions, asset, price } = await c.purchaseLicenseIxs(wallet, row.id, row.price);
    return buildForUserChecked(instructions, { kind: "purchase", asset: asset.address, priceUsdc: unitsToUsdc(price), agentId: row.id });
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
      // Sem resposta conclusiva da rede (timeout, erro de rede): a transação PODE ter entrado. Não diz "falhou"
      // (o front responde "nada foi cobrado" a 422/status failed): 409 com code "unconfirmed" e a assinatura.
      if (e instanceof TxError && e.phase === "unconfirmed") {
        throw new HttpError(409, "Não conseguimos confirmar se a transação foi concluída. Confira em alguns instantes antes de tentar de novo: ela pode ter entrado.", "unconfirmed", {
          signature: e.signature ?? "",
          explorerUrl: e.signature ? explorerUrl("tx", e.signature) : undefined,
        });
      }
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

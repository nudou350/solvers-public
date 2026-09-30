import { Router } from "express";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { averageRating, bpsToScore, unitsToUsdc, type ConnectorStatus, type CreatorDashboard, type Memory } from "@solvers/shared";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { decodeVerifiedSignature, MEMORY_KEY_MESSAGE } from "../auth/siws.js";
import { h, HttpError, notFound, parse, unauthorized } from "../lib/http.js";
import { deleteAllMemories, deleteMemory, deriveMemoryKey, memoryKeyFor, readMemories, storeMemoryKey, wrapKey } from "../memory/crypto.js";
import { getCreator } from "./catalog.js";
import { chain } from "../chain/index.js";

export const meRouter = Router();

// ---------- Memórias (vitrine) ----------

/** A vitrine pede a assinatura da mensagem fixa e envia aqui; a chave vale enquanto a sessão durar. */
meRouter.post(
  "/me/memory-key",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    if (!req.tokenId) throw unauthorized("Sessão sem identificador; entre novamente");
    const { signature } = parse(z.object({ signature: z.union([z.string(), z.array(z.number())]) }), req.body);
    const sig = decodeVerifiedSignature(wallet, MEMORY_KEY_MESSAGE, signature);
    if (!sig) throw unauthorized("Assinatura inválida");
    await storeMemoryKey(req.tokenId, wallet, wrapKey(deriveMemoryKey(sig, wallet)), new Date(Date.now() + 24 * 3600 * 1000));
    return { ok: true };
  }),
);

meRouter.get(
  "/me/memories",
  requireAuth,
  h(async (req): Promise<Memory[]> => {
    const wallet = requireWallet(req);
    const key = await memoryKeyFor(req.tokenId, wallet);
    if (!key) {
      throw new HttpError(409, "Para ver suas memórias, confirme a assinatura na carteira.", "memory_key_required", {
        message: MEMORY_KEY_MESSAGE,
      });
    }
    const mems = await readMemories(wallet, key);
    return mems.map((m) => ({ id: m.id, agentId: m.agentId, summary: m.summary, updatedAt: m.updatedAt.toISOString() }));
  }),
);

meRouter.get(
  "/me/memories/count",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const rows = await db
      .select({ agentId: schema.memories.agentId, updatedAt: schema.memories.updatedAt })
      .from(schema.memories)
      .where(eq(schema.memories.wallet, wallet));
    return { count: rows.length, agents: rows.map((r) => ({ agentId: r.agentId, updatedAt: r.updatedAt.toISOString() })) };
  }),
);

meRouter.delete(
  "/me/memories/:id",
  requireAuth,
  h(async (req) => {
    if (!(await deleteMemory(requireWallet(req), String(req.params.id)))) throw notFound("Memória não encontrada");
    return { ok: true };
  }),
);

meRouter.delete(
  "/me/memories",
  requireAuth,
  h(async (req) => {
    await deleteAllMemories(requireWallet(req));
    return { ok: true };
  }),
);

// ---------- Conector ----------

meRouter.get(
  "/connector",
  requireAuth,
  h(async (req): Promise<ConnectorStatus> => {
    const wallet = requireWallet(req);
    const rows = await db
      .select({ clientId: schema.oauthTokens.clientId, createdAt: schema.oauthTokens.createdAt, metadata: schema.oauthClients.metadata })
      .from(schema.oauthTokens)
      .innerJoin(schema.oauthClients, eq(schema.oauthClients.clientId, schema.oauthTokens.clientId))
      .where(and(eq(schema.oauthTokens.wallet, wallet), eq(schema.oauthTokens.revoked, false), gt(schema.oauthTokens.expiresAt, new Date())))
      .orderBy(desc(schema.oauthTokens.createdAt));
    const seen = new Set<string>();
    const authorizedClients = rows
      .filter((r) => (seen.has(r.clientId) ? false : seen.add(r.clientId)))
      .map((r) => ({ clientName: String((r.metadata as { client_name?: string }).client_name ?? "Assistente de IA"), authorizedAt: r.createdAt.toISOString() }));
    return { url: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/mcp`, authorizedClients };
  }),
);

meRouter.post(
  "/connector/revoke",
  requireAuth,
  h(async (req) => {
    const wallet = requireWallet(req);
    const toks = await db
      .update(schema.oauthTokens)
      .set({ revoked: true })
      .where(and(eq(schema.oauthTokens.wallet, wallet), eq(schema.oauthTokens.revoked, false)))
      .returning({ id: schema.oauthTokens.id });
    if (toks.length) await db.delete(schema.memoryKeys).where(inArray(schema.memoryKeys.tokenId, toks.map((t) => t.id)));
    return { revoked: toks.length };
  }),
);

// ---------- Painel do criador ----------

meRouter.get(
  "/creator/dashboard",
  requireAuth,
  h(async (req): Promise<CreatorDashboard> => {
    const wallet = requireWallet(req);
    const [creatorRow] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, wallet));
    const empty: CreatorDashboard = {
      creator: null,
      totals: { sales: 0, uses: 0, salesRevenueUsdc: 0, royaltiesUsdc: 0, disputesOpened: 0, disputesOpen: 0, disputesLost: 0 },
      last30: { sales: 0, uses: 0, revenueUsdc: 0 },
      creatorSharePct: 90,
      agents: [],
      daily: [],
      disputes: [],
    };
    if (!creatorRow) return empty;
    const feeBps = (await chain().fetchConfig().catch(() => null))?.data.feeBps ?? 1000;
    const share = 1 - feeBps / 10_000;
    const net = (usdc: number) => Math.round(usdc * share * 100) / 100;
    empty.creatorSharePct = Math.round(share * 1000) / 10;
    const agents = await db.select().from(schema.agents).where(eq(schema.agents.creatorId, creatorRow.id));
    if (agents.length === 0) return { ...empty, creator: await getCreator(creatorRow.id) };
    const ids = agents.map((a) => a.id);

    // Contestações de etapas de garantia dos especialistas deste criador.
    const disputeRows = await db
      .select({
        escrowId: schema.milestones.escrowId,
        index: schema.milestones.idx,
        agentId: schema.escrows.agentId,
        taskTitle: schema.escrows.title,
        milestoneTitle: schema.milestones.title,
        criterion: schema.milestones.disputeCriterion,
        reason: schema.milestones.disputeReason,
        amount: schema.milestones.amount,
        status: schema.milestones.status,
        openedAt: schema.milestones.disputedAt,
      })
      .from(schema.milestones)
      .innerJoin(schema.escrows, eq(schema.escrows.id, schema.milestones.escrowId))
      // disputedAt só é gravado quando a contestação foi confirmada on-chain (tentativas abandonadas ficam de fora).
      .where(and(inArray(schema.escrows.agentId, ids), isNotNull(schema.milestones.disputedAt)))
      .orderBy(desc(schema.milestones.disputedAt));
    const disputes = disputeRows
      .filter((d) => ["disputed", "refunded", "approved"].includes(d.status))
      .map((d) => ({
        escrowId: d.escrowId,
        index: d.index,
        agentId: d.agentId,
        taskTitle: d.taskTitle,
        milestoneTitle: d.milestoneTitle,
        criterion: d.criterion,
        reason: d.reason,
        amountUsdc: unitsToUsdc(d.amount),
        openedAt: d.openedAt?.toISOString() ?? null,
        result: (d.status === "disputed" ? "open" : d.status === "refunded" ? "buyer" : "creator") as "open" | "buyer" | "creator",
      }));
    const disputesBy = new Map<string, number>();
    for (const d of disputes) disputesBy.set(d.agentId, (disputesBy.get(d.agentId) ?? 0) + 1);

    // Receita pelo valor efetivamente pago (licenças e pacotes de créditos), já sem a taxa da plataforma.
    const paid = await db
      .select({ agentId: schema.chainTxs.agentId, sum: sql<string>`coalesce(sum(${schema.chainTxs.amount}), 0)` })
      .from(schema.chainTxs)
      .where(and(inArray(schema.chainTxs.agentId, ids), inArray(schema.chainTxs.kind, ["purchase", "credits"])))
      .groupBy(schema.chainTxs.agentId);
    const paidBy = new Map(paid.map((p) => [p.agentId, unitsToUsdc(BigInt(p.sum))]));

    const perAgent = agents.map((a) => ({
      agentId: a.id,
      slug: a.slug,
      name: a.name,
      version: a.version,
      status: (["active", "pending", "suspended"].includes(a.status) ? a.status : "pending") as "active" | "pending" | "suspended",
      listed: a.listed,
      userRating: averageRating(a.ratingSum, a.ratingCount),
      evalScore: bpsToScore(a.evalScoreBps),
      sales: Number(a.totalSales),
      uses: Number(a.verifiedUses),
      revenueUsdc: net(paidBy.get(a.id) ?? 0),
      disputes: disputesBy.get(a.id) ?? 0,
    }));

    const daily = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${schema.chainTxs.createdAt}), 'YYYY-MM-DD')`,
        // "Vendas" = licenças (mesma conta do total on-chain); a receita inclui os pacotes de créditos.
        sales: sql<number>`count(*) filter (where ${schema.chainTxs.kind} = 'purchase')`.mapWith(Number),
        revenue: sql<number>`coalesce(sum(${schema.chainTxs.amount}) filter (where ${schema.chainTxs.kind} in ('purchase', 'credits')), 0)`.mapWith(Number),
      })
      .from(schema.chainTxs)
      .where(and(inArray(schema.chainTxs.agentId, ids), gt(schema.chainTxs.createdAt, sql`now() - interval '30 days'`)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const usesDaily = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${schema.usageEvents.createdAt}), 'YYYY-MM-DD')`,
        uses: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.usageEvents)
      .where(and(inArray(schema.usageEvents.agentId, ids), eq(schema.usageEvents.tool, "activate_solver"), gt(schema.usageEvents.createdAt, sql`now() - interval '30 days'`)))
      .groupBy(sql`1`);
    const usesBy = new Map(usesDaily.map((u) => [u.date, u.uses]));
    const dates = new Set([...daily.map((d) => d.date), ...usesDaily.map((u) => u.date)]);
    const dailyOut = [...dates].sort().map((date) => {
      const d = daily.find((x) => x.date === date);
      return {
        date,
        sales: d?.sales ?? 0,
        uses: usesBy.get(date) ?? 0,
        revenueUsdc: net(unitsToUsdc(BigInt(Math.round(d?.revenue ?? 0)))),
      };
    });

    const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
    return {
      creator: await getCreator(creatorRow.id),
      totals: {
        sales: sum(perAgent, (a) => a.sales),
        uses: sum(perAgent, (a) => a.uses),
        salesRevenueUsdc: Math.round(sum(perAgent, (a) => a.revenueUsdc) * 100) / 100,
        // Revenda é P2: royalties começam em zero até o mercado de revenda existir on-chain.
        royaltiesUsdc: 0,
        disputesOpened: disputes.length,
        disputesOpen: disputes.filter((d) => d.result === "open").length,
        disputesLost: sum(agents, (a) => a.disputesLost),
      },
      last30: {
        sales: sum(dailyOut, (d) => d.sales),
        uses: sum(dailyOut, (d) => d.uses),
        revenueUsdc: Math.round(sum(dailyOut, (d) => d.revenueUsdc) * 100) / 100,
      },
      creatorSharePct: Math.round(share * 1000) / 10,
      agents: perAgent,
      daily: dailyOut,
      disputes,
    };
  }),
);

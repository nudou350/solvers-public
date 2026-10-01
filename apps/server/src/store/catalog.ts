import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Agent, AgentDetail, Creator, CreatorProfile, GuaranteeOffer } from "@solvers/shared";
import { unitsToUsdc, averageRating, splitGuaranteeAmounts } from "@solvers/shared";
import { env } from "../env.js";
import { db, schema } from "../db/index.js";
import { notFound } from "../lib/http.js";
import { isAgentId } from "../runtime/agent-ids.js";
import { getPackage } from "../runtime/packages.js";
import { trialInfo } from "../runtime/trial.js";
import { brlPerUsd } from "./fx.js";
import { textMatchesHash } from "./review-rules.js";
import { guaranteeOffered, toAgent, toCreator, toReview, type AgentExtras, type CreatorStats } from "./mappers.js";

type AgentRow = typeof schema.agents.$inferSelect;

/** Tendência de uso (% de variação dos usos dos últimos 7 dias contra os 7 anteriores) e piso de revenda. */
export async function agentExtras(ids: string[]): Promise<Map<string, AgentExtras>> {
  const out = new Map<string, AgentExtras>(ids.map((id) => [id, { trend7d: 0, resaleFloor: null }]));
  if (ids.length === 0) return out;
  const usage = await db
    .select({
      agentId: schema.usageEvents.agentId,
      recent: sql<number>`count(*) filter (where ${schema.usageEvents.createdAt} > now() - interval '7 days')`.mapWith(Number),
      previous: sql<number>`count(*) filter (where ${schema.usageEvents.createdAt} <= now() - interval '7 days' and ${schema.usageEvents.createdAt} > now() - interval '14 days')`.mapWith(Number),
    })
    .from(schema.usageEvents)
    .where(and(inArray(schema.usageEvents.agentId, ids), sql`${schema.usageEvents.tool} = 'activate_solver'`))
    .groupBy(schema.usageEvents.agentId);
  for (const u of usage) {
    if (!u.agentId) continue;
    const trend = u.previous === 0 ? (u.recent > 0 ? 100 : 0) : ((u.recent - u.previous) / u.previous) * 100;
    out.get(u.agentId)!.trend7d = Math.round(trend * 10) / 10;
  }
  const floors = await db
    .select({ agentId: schema.licenses.agentId, floor: sql<string>`min(${schema.licenses.resalePrice})` })
    .from(schema.licenses)
    .where(and(inArray(schema.licenses.agentId, ids), eq(schema.licenses.listedForResale, true)))
    .groupBy(schema.licenses.agentId);
  for (const f of floors) if (f.floor != null) out.get(f.agentId)!.resaleFloor = BigInt(f.floor);
  return out;
}

export async function mapAgents(rows: AgentRow[]): Promise<Agent[]> {
  const extras = await agentExtras(rows.map((r) => r.id));
  return rows.map((r) => toAgent(r, extras.get(r.id)!));
}

export type ListQuery = { q?: string; category?: string; sort?: "rating" | "uses" | "trend" | "new"; limit?: number };

/** Usos (ativações) dos últimos 7 dias contra os 7 anteriores, calculado no banco para ordenar. */
const trendSql = sql`(
  select case when prev = 0 then (case when recent > 0 then 100 else 0 end) else (recent - prev)::float / prev * 100 end
  from (
    select
      count(*) filter (where u.created_at > now() - interval '7 days') as recent,
      count(*) filter (where u.created_at <= now() - interval '7 days' and u.created_at > now() - interval '14 days') as prev
    from usage_events u
    where u.agent_id = ${schema.agents.id} and u.tool = 'activate_solver'
  ) t
)`;

/** Data da primeira versão do manifest (a mesma de Agent.publishedAt), ou do cadastro. */
const publishedAtSql = sql`coalesce(
  (select min((v->>'releasedAt')::timestamptz) from jsonb_array_elements(coalesce(${schema.agents.details}->'versions', '[]'::jsonb)) v),
  ${schema.agents.createdAt}
)`;

export async function listAgents(query: ListQuery): Promise<Agent[]> {
  const conds = [eq(schema.agents.status, "active"), eq(schema.agents.platformStatus, "active"), eq(schema.agents.listed, true)];
  if (query.category) conds.push(eq(schema.agents.category, query.category));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(
      or(
        sql`to_tsvector('portuguese', ${schema.agents.searchText}) @@ plainto_tsquery('portuguese', ${query.q})`,
        sql`${schema.agents.name} ilike ${like}`,
        sql`${schema.agents.tagline} ilike ${like}`,
      )!,
    );
  }
  const order =
    query.sort === "uses"
      ? [desc(schema.agents.verifiedUses)]
      : query.sort === "new"
        ? [desc(publishedAtSql)]
        : query.sort === "trend"
          ? [desc(trendSql), desc(schema.agents.verifiedUses)]
          : [desc(sql`case when ${schema.agents.ratingCount} = 0 then 0 else ${schema.agents.ratingSum}::float / ${schema.agents.ratingCount} end`), desc(schema.agents.ratingCount)];
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(...conds))
    .orderBy(...order)
    .limit(query.limit ?? 100);
  return mapAgents(rows);
}

/**
 * Busca por `id` (32 hex) ou `slug`, nunca pelos dois ao mesmo tempo: o formato decide a coluna.
 * Um slug não pode ter formato de id (validado no manifest), então não há como um agente "roubar" a busca de outro.
 */
export async function findAgentRow(idOrSlug: string): Promise<AgentRow> {
  const [row] = await db
    .select()
    .from(schema.agents)
    .where(isAgentId(idOrSlug) ? eq(schema.agents.id, idOrSlug) : eq(schema.agents.slug, idOrSlug))
    .limit(1);
  if (!row) throw notFound("Especialista não encontrado");
  return row;
}

export async function creatorStats(creatorId: string): Promise<CreatorStats> {
  const [s] = await db
    .select({
      totalSales: sql<number>`coalesce(sum(${schema.agents.totalSales}), 0)`.mapWith(Number),
      ratingSum: sql<number>`coalesce(sum(${schema.agents.ratingSum}), 0)`.mapWith(Number),
      ratingCount: sql<number>`coalesce(sum(${schema.agents.ratingCount}), 0)`.mapWith(Number),
      disputesLost: sql<number>`coalesce(sum(${schema.agents.disputesLost}), 0)`.mapWith(Number),
      agentsPublished: sql<number>`count(*) filter (where ${schema.agents.status} = 'active' and ${schema.agents.platformStatus} = 'active')`.mapWith(Number),
    })
    .from(schema.agents)
    .where(eq(schema.agents.creatorId, creatorId));
  return {
    totalSales: s?.totalSales ?? 0,
    avgRating: averageRating(s?.ratingSum ?? 0, s?.ratingCount ?? 0),
    disputesLost: s?.disputesLost ?? 0,
    agentsPublished: s?.agentsPublished ?? 0,
  };
}

export async function getCreator(creatorId: string) {
  const [row] = await db.select().from(schema.creators).where(eq(schema.creators.id, creatorId));
  if (!row) return null;
  return toCreator(row, await creatorStats(creatorId));
}

/** Todos os criadores com especialista na vitrine (para os cards mostrarem nome e reputação). */
export async function listCreators(): Promise<Creator[]> {
  const rows = await db
    .select()
    .from(schema.creators)
    .where(
      sql`exists (select 1 from ${schema.agents} a where a.creator_id = ${schema.creators.id} and a.status = 'active' and a.platform_status = 'active' and a.listed)`,
    )
    .orderBy(schema.creators.name);
  return Promise.all(rows.map(async (r) => toCreator(r, await creatorStats(r.id))));
}

export async function getCreatorProfile(creatorId: string): Promise<CreatorProfile> {
  const creator = await getCreator(creatorId);
  if (!creator) throw notFound("Criador não encontrado");
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.creatorId, creatorId), eq(schema.agents.status, "active"), eq(schema.agents.platformStatus, "active"), eq(schema.agents.listed, true)));
  return { creator, agents: await mapAgents(rows) };
}

export async function listReviews(agentId: string, limit = 50) {
  const rows = await db
    .select()
    .from(schema.reviews)
    .where(and(eq(schema.reviews.agentId, agentId), eq(schema.reviews.onchain, true)))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(limit);
  const wallets = [...new Set(rows.map((r) => r.authorWallet))];
  const names = wallets.length
    ? await db
        .select({ wallet: schema.userProfiles.wallet, name: schema.userProfiles.displayName })
        .from(schema.userProfiles)
        .where(inArray(schema.userProfiles.wallet, wallets))
    : [];
  const nameOf = new Map(names.map((n) => [n.wallet, n.name]));
  // O texto é off-chain: só aparece se o sha256 dele bate com o hash confirmado on-chain.
  return rows.map((r) => toReview(textMatchesHash(r.text, r.contentHash) ? r : { ...r, text: "" }, nameOf.get(r.authorWallet) ?? null));
}

export async function getAgentDetail(idOrSlug: string): Promise<AgentDetail> {
  const row = await findAgentRow(idOrSlug);
  const [agent] = await mapAgents([row]);
  const creator =
    (await getCreator(row.creatorId)) ?? {
      id: row.creatorId,
      name: "Criador",
      avatarUrl: null,
      bio: "",
      reputationScore: 50,
      disputesLost: 0,
      agentsPublished: 1,
    };
  const rate = await brlPerUsd();
  const dist = await db
    .select({ rating: schema.reviews.rating, n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.agentId, row.id), eq(schema.reviews.onchain, true)))
    .groupBy(schema.reviews.rating);
  const resale = await db
    .select()
    .from(schema.resalePrices)
    .where(eq(schema.resalePrices.agentId, row.id))
    .orderBy(schema.resalePrices.at)
    .limit(60);
  return {
    agent: agent!,
    creator,
    reviews: await listReviews(row.id, 10),
    beforeAfter: row.details.beforeAfter ?? [],
    versions: row.details.versions ?? [
      { version: row.version, versionHash: row.versionHash, releasedAt: row.createdAt.toISOString(), notes: "Versão atual", evalScore: agent!.evalScore },
    ],
    trial: agentTrial(row.id),
    priceBrl: Math.round(unitsToUsdc(row.price) * rate * 100) / 100,
    resalePriceHistory: resale.map((r) => ({ date: r.at.toISOString(), priceUsdc: unitsToUsdc(r.price) })),
    ratingDistribution: [5, 4, 3, 2, 1].map((star) => dist.find((d) => d.rating === star)?.n ?? 0),
    onchain: {
      agent: row.onchainAddress,
      collection: row.collectionAddress,
      creatorWallet: (await db.select({ wallet: schema.creators.wallet }).from(schema.creators).where(eq(schema.creators.id, row.creatorId)))[0]?.wallet ?? null,
    },
    guarantee: guaranteeOffer(row, rate),
  };
}

/** Teste grátis do manifest em disco (o mesmo que o conector aplica); null se não houver. */
function agentTrial(agentId: string) {
  const pkg = getPackage(agentId);
  return pkg ? trialInfo(pkg) : null;
}

/** Modelo de tarefa com garantia do criador, com o valor de cada etapa já calculado. */
export function guaranteeOffer(row: AgentRow, brlRate: number): GuaranteeOffer | null {
  const t = row.details.guaranteeTemplate;
  if (!t || !guaranteeOffered(row)) return null;
  const amounts = splitGuaranteeAmounts(t.priceUsdc, t.milestones.map((m) => m.sharePct));
  return {
    priceUsdc: t.priceUsdc,
    priceBrl: Math.round(t.priceUsdc * brlRate * 100) / 100,
    reviewWindowSecs: env.ESCROW_REVIEW_WINDOW_SECS,
    milestones: t.milestones.map((m, i) => ({ title: m.title, criteria: m.criteria, amountUsdc: amounts[i]!, verify: m.verify ?? "tests" })),
  };
}

export async function listCategories(): Promise<{ category: string; count: number }[]> {
  return db
    .select({ category: schema.agents.category, count: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.agents)
    .where(and(eq(schema.agents.status, "active"), eq(schema.agents.platformStatus, "active"), eq(schema.agents.listed, true)))
    .groupBy(schema.agents.category)
    .orderBy(schema.agents.category);
}

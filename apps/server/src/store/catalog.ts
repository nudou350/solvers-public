import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Agent, AgentDetail, CreatorProfile } from "@solvers/shared";
import { FREE_TRIAL_USES, unitsToUsdc, averageRating } from "@solvers/shared";
import { db, schema } from "../db/index.js";
import { notFound } from "../lib/http.js";
import { brlPerUsd } from "./fx.js";
import { toAgent, toCreator, toReview, type AgentExtras, type CreatorStats } from "./mappers.js";

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

export async function listAgents(query: ListQuery): Promise<Agent[]> {
  const conds = [eq(schema.agents.status, "active")];
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
        ? [desc(schema.agents.createdAt)]
        : [desc(sql`case when ${schema.agents.ratingCount} = 0 then 0 else ${schema.agents.ratingSum}::float / ${schema.agents.ratingCount} end`), desc(schema.agents.ratingCount)];
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(...conds))
    .orderBy(...order)
    .limit(query.limit ?? 100);
  const agents = await mapAgents(rows);
  if (query.sort === "trend") agents.sort((a, b) => b.trend7d - a.trend7d);
  return agents;
}

export async function findAgentRow(idOrSlug: string): Promise<AgentRow> {
  const [row] = await db
    .select()
    .from(schema.agents)
    .where(or(eq(schema.agents.id, idOrSlug), eq(schema.agents.slug, idOrSlug)))
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
      agentsPublished: sql<number>`count(*) filter (where ${schema.agents.status} = 'active')`.mapWith(Number),
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

export async function getCreatorProfile(creatorId: string): Promise<CreatorProfile> {
  const creator = await getCreator(creatorId);
  if (!creator) throw notFound("Criador não encontrado");
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.creatorId, creatorId), eq(schema.agents.status, "active")));
  return { creator, agents: await mapAgents(rows) };
}

export async function listReviews(agentId: string, limit = 50) {
  const rows = await db
    .select()
    .from(schema.reviews)
    .where(and(eq(schema.reviews.agentId, agentId), eq(schema.reviews.onchain, true)))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(limit);
  return rows.map(toReview);
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
    freeTrialUses: FREE_TRIAL_USES,
    priceBrl: Math.round(unitsToUsdc(row.price) * rate * 100) / 100,
    pricePerUseBrl: row.pricePerUse > 0n ? Math.round(unitsToUsdc(row.pricePerUse) * rate * 100) / 100 : null,
    resalePriceHistory: resale.map((r) => ({ date: r.at.toISOString(), priceUsdc: unitsToUsdc(r.price) })),
  };
}

export async function listCategories(): Promise<{ category: string; count: number }[]> {
  return db
    .select({ category: schema.agents.category, count: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.agents)
    .where(eq(schema.agents.status, "active"))
    .groupBy(schema.agents.category)
    .orderBy(schema.agents.category);
}

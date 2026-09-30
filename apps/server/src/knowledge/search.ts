import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { embed, embeddingsLoaded, toVectorLiteral } from "./embeddings.js";

type AgentRow = typeof schema.agents.$inferSelect;

/** Busca em linguagem natural na vitrine e no find_solver: top N solvers ativos para a necessidade. */
export async function searchAgentRows(need: string, limit = 3): Promise<AgentRow[]> {
  const listed = and(eq(schema.agents.status, "active"), eq(schema.agents.listed, true));
  // Enquanto o modelo carrega (primeiro boot), usa full text para não travar a requisição.
  const vec = embeddingsLoaded() ? (await embed([need], "query"))?.[0] : undefined;
  if (vec) {
    const rows = await db
      .select()
      .from(schema.agents)
      .where(and(listed, sql`${schema.agents.embedding} is not null`))
      .orderBy(sql`${schema.agents.embedding} <=> ${toVectorLiteral(vec)}::vector`)
      .limit(limit);
    if (rows.length > 0) return rows;
  }
  const rank = sql`ts_rank(to_tsvector('portuguese', ${schema.agents.searchText}), websearch_to_tsquery('portuguese', ${need}))`;
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(listed, sql`to_tsvector('portuguese', ${schema.agents.searchText}) @@ websearch_to_tsquery('portuguese', ${need})`))
    .orderBy(desc(rank))
    .limit(limit);
  if (rows.length > 0) return rows;
  // Sem nenhum termo em comum: busca por qualquer palavra (OR) antes de desistir.
  const words = need
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3)
    .slice(0, 8);
  if (words.length > 0) {
    const orQuery = words.join(" | ");
    const anyRows = await db
      .select()
      .from(schema.agents)
      .where(
        and(listed, sql`to_tsvector('portuguese', ${schema.agents.searchText}) @@ to_tsquery('portuguese', ${orQuery})`),
      )
      .orderBy(desc(sql`ts_rank(to_tsvector('portuguese', ${schema.agents.searchText}), to_tsquery('portuguese', ${orQuery}))`))
      .limit(limit);
    if (anyRows.length > 0) return anyRows;
  }
  return [];
}

export type KnowledgeHit = { source: string; content: string; score: number };

/** Até N trechos da base de conhecimento do solver (versão atual) mais relevantes para a pergunta. */
export async function searchKnowledge(agentId: string, version: string, query: string, limit = 5): Promise<KnowledgeHit[]> {
  const base = and(eq(schema.knowledgeChunks.agentId, agentId), eq(schema.knowledgeChunks.version, version));
  const vec = embeddingsLoaded() ? (await embed([query], "query"))?.[0] : undefined;
  if (vec) {
    const dist = sql<number>`${schema.knowledgeChunks.embedding} <=> ${toVectorLiteral(vec)}::vector`;
    const rows = await db
      .select({ source: schema.knowledgeChunks.source, content: schema.knowledgeChunks.content, dist })
      .from(schema.knowledgeChunks)
      .where(and(base, sql`${schema.knowledgeChunks.embedding} is not null`))
      .orderBy(dist)
      .limit(limit);
    if (rows.length > 0) return rows.map((r) => ({ source: r.source, content: r.content, score: 1 - Number(r.dist) }));
  }
  const rank = sql<number>`ts_rank(to_tsvector('portuguese', ${schema.knowledgeChunks.content}), websearch_to_tsquery('portuguese', ${query}))`;
  const rows = await db
    .select({ source: schema.knowledgeChunks.source, content: schema.knowledgeChunks.content, rank })
    .from(schema.knowledgeChunks)
    .where(and(base, sql`to_tsvector('portuguese', ${schema.knowledgeChunks.content}) @@ websearch_to_tsquery('portuguese', ${query})`))
    .orderBy(desc(rank))
    .limit(limit);
  if (rows.length > 0) return rows.map((r) => ({ source: r.source, content: r.content, score: Number(r.rank) }));
  // Nada casou: devolve os primeiros trechos (visão geral) para a IA não ficar sem contexto.
  const first = await db.select().from(schema.knowledgeChunks).where(base).limit(Math.min(limit, 2));
  return first.map((r) => ({ source: r.source, content: r.content, score: 0 }));
}

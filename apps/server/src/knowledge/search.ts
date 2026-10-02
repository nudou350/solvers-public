import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { embed, embeddingsLoaded, toVectorLiteral } from "./embeddings.js";

type AgentRow = typeof schema.agents.$inferSelect;

/** Distância de cosseno máxima acima do melhor resultado para ainda aparecer como sugestão. */
const RELEVANCE_MARGIN = 0.01;

/** Busca em linguagem natural na vitrine e no find_solver: top N solvers ativos para a necessidade. */
export async function searchAgentRows(need: string, limit = 3): Promise<AgentRow[]> {
  const listed = and(eq(schema.agents.status, "active"), eq(schema.agents.platformStatus, "active"), eq(schema.agents.listed, true));
  // Enquanto o modelo carrega (primeiro boot), usa full text para não travar a requisição.
  const vec = embeddingsLoaded() ? (await embed([need], "query"))?.[0] : undefined;
  if (vec) {
    // Distância do solver = a do vetor que casar melhor (texto todo, tagline ou uma das searchPhrases).
    const q = sql`${toVectorLiteral(vec)}::vector`;
    // Colunas qualificadas à mão: no select o drizzle escreve só "id", que na subconsulta seria o de v.
    const dist = sql<number>`least(${schema.agents}.embedding <=> ${q}, (select min(v.embedding <=> ${q}) from ${schema.agentSearchVectors} v where v.agent_id = ${schema.agents}.id))`;
    const rows = await db
      .select({ agent: schema.agents, dist })
      .from(schema.agents)
      .where(and(listed, sql`${schema.agents.embedding} is not null`))
      .orderBy(dist)
      .limit(limit);
    // As distâncias do e5 ficam todas numa faixa estreita: só entra quem está colado no melhor,
    // senão um pedido claro ("site bonito") vem acompanhado de viagens e copy só para completar 3.
    if (rows.length > 0) return rows.filter((r) => Number(r.dist) - Number(rows[0]!.dist) <= RELEVANCE_MARGIN).map((r) => r.agent);
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

export type KnowledgeHit = { source: string; content: string; score: number; meta: Record<string, unknown> | null; validUntil: string | null };

/**
 * Até N trechos da base de conhecimento do solver (versão atual) mais relevantes para a pergunta.
 * `trialOnly`: só trechos de arquivos com `trial: true` no front-matter (teste grátis de pacote v1).
 */
export async function searchKnowledge(agentId: string, version: string, query: string, limit = 5, opts: { trialOnly?: boolean } = {}): Promise<KnowledgeHit[]> {
  const kc = schema.knowledgeChunks;
  const base = and(eq(kc.agentId, agentId), eq(kc.version, version), opts.trialOnly ? sql`${kc.meta} ->> 'trial' = 'true'` : undefined);
  const cols = { source: kc.source, content: kc.content, meta: kc.meta, validUntil: kc.validUntil };
  const hit = (r: { source: string; content: string; meta: Record<string, unknown> | null; validUntil: string | null }, score: number): KnowledgeHit => ({
    source: r.source,
    content: r.content,
    score,
    meta: r.meta ?? null,
    validUntil: r.validUntil ?? null,
  });
  const vec = embeddingsLoaded() ? (await embed([query], "query"))?.[0] : undefined;
  if (vec) {
    const dist = sql<number>`${kc.embedding} <=> ${toVectorLiteral(vec)}::vector`;
    const rows = await db
      .select({ ...cols, dist })
      .from(kc)
      .where(and(base, sql`${kc.embedding} is not null`))
      .orderBy(dist)
      .limit(limit);
    if (rows.length > 0) return rows.map((r) => hit(r, 1 - Number(r.dist)));
  }
  const rank = sql<number>`ts_rank(to_tsvector('portuguese', ${kc.content}), websearch_to_tsquery('portuguese', ${query}))`;
  const rows = await db
    .select({ ...cols, rank })
    .from(kc)
    .where(and(base, sql`to_tsvector('portuguese', ${kc.content}) @@ websearch_to_tsquery('portuguese', ${query})`))
    .orderBy(desc(rank))
    .limit(limit);
  if (rows.length > 0) return rows.map((r) => hit(r, Number(r.rank)));
  // Nada casou: devolve os primeiros trechos (visão geral) para a IA não ficar sem contexto.
  const first = await db.select(cols).from(kc).where(base).orderBy(kc.id).limit(Math.min(limit, 2));
  return first.map((r) => hit(r, 0));
}

// Tipos e helpers do catálogo (home, especialista, criador).
// Formatação, selo de reputação e duração em lib/format; explorador e rede em lib/explorer; --gap em lib/style.
import type { Creator } from "@solvers/api-client";

/** Criador resumido para os cards: nome e reputação (de getCreators()). */
export type CreatorMini = { name: string; reputationScore: number };
export type CreatorMap = Record<string, CreatorMini>;

export function creatorMap(list: Creator[]): CreatorMap {
  return Object.fromEntries(list.map((c) => [c.id, { name: c.name, reputationScore: c.reputationScore }]));
}

export const agentHref = (slug: string) => `/especialistas/${encodeURIComponent(slug)}`;
export const creatorHref = (id: string) => `/criadores/${encodeURIComponent(id)}`;

/** "Nenhuma contestação perdida" / "1 contestação perdida" / "3 contestações perdidas". */
export function disputesText(n: number): string {
  if (n === 0) return "Nenhuma contestação perdida";
  return n === 1 ? "1 contestação perdida" : `${n} contestações perdidas`;
}

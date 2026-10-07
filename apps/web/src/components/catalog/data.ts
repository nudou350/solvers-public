// Tipos e helpers do catálogo (home, especialista, criador).
// Formatação, selo de reputação e duração em lib/format; explorador e rede em lib/explorer; --gap em lib/style.
// O texto de contestações perdidas vive em messages/<locale>/catalog.json (chave "disputes").
import type { Creator } from "@solvers/api-client";

/** Criador resumido para os cards: nome e reputação (de getCreators()). */
export type CreatorMini = { name: string; reputationScore: number };
export type CreatorMap = Record<string, CreatorMini>;

export function creatorMap(list: Creator[]): CreatorMap {
  return Object.fromEntries(list.map((c) => [c.id, { name: c.name, reputationScore: c.reputationScore }]));
}

export const agentHref = (slug: string) => `/solvers/${encodeURIComponent(slug)}`;
export const creatorHref = (id: string) => `/creators/${encodeURIComponent(id)}`;

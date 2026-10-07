import type { AgentTranslations } from "@solvers/shared";
import type { Manifest } from "../runtime/manifest.js";

// Regras puras do texto de busca do catálogo (sem banco nem modelo de embeddings): testadas em test/catalog-rules.test.ts.
// O texto em inglês é o do manifest; o português (locales/pt.json) entra como texto extra e como vetores extras, para
// que um pedido em português continue achando o Solver (o modelo de busca é multilíngue).

type CatalogManifest = Pick<Manifest, "name" | "tagline" | "description" | "category" | "packageContents" | "requirements" | "searchPhrases">;

/** Texto do manifest (inglês) que vira o vetor principal do Solver. */
export function manifestSearchText(m: CatalogManifest): string {
  return [m.name, m.tagline, m.description, m.category, ...m.packageContents, ...m.requirements.map((r) => r.label)].join("\n");
}

/** Texto em português da tradução (nome, tagline, descrição, conteúdo e requisitos); vazio sem tradução. */
export function translationSearchText(translations: AgentTranslations | null | undefined): string {
  const pt = translations?.pt;
  if (!pt) return "";
  return [pt.name, pt.tagline, pt.description, ...pt.packageContents, ...pt.requirements.map((r) => r.label)].join("\n");
}

/**
 * Coluna `agents.search_text`: inglês e, se houver, o português em seguida (a busca por texto cobre os dois idiomas).
 * O vetor principal usa só `manifestSearchText`: misturar os idiomas num vetor só o deixaria no meio do caminho.
 */
export function fullSearchText(m: CatalogManifest, translations: AgentTranslations | null | undefined): string {
  const pt = translationSearchText(translations);
  return pt ? `${manifestSearchText(m)}\n${pt}` : manifestSearchText(m);
}

/**
 * Frases curtas que viram vetores extras (um por frase): nome e tagline, os pedidos típicos (searchPhrases) e, com a tradução,
 * os mesmos em português mais o texto todo em português (pedido longo em português casa com ele).
 */
export function searchPhrasesOf(m: CatalogManifest, translations: AgentTranslations | null | undefined): string[] {
  const phrases = [`${m.name}: ${m.tagline}`, ...m.searchPhrases];
  const pt = translations?.pt;
  if (pt) phrases.push(`${pt.name}: ${pt.tagline}`, ...(pt.searchPhrases ?? []), translationSearchText(translations));
  // Sem repetir (nome igual nos dois idiomas, por exemplo): vetor repetido só gasta embedding.
  return [...new Set(phrases)];
}

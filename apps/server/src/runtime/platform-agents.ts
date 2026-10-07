import { HttpError } from "../lib/http.js";

// Solvers da plataforma (PACKAGE_SPEC.md 4.1 e 19): gratuitos, só no banco (sem conta on-chain), sem licença e sem
// teste grátis. A AUTORIDADE é esta lista do servidor, nunca o campo `platform` do manifesto: o manifesto só vale
// se a dupla slug+id estiver aqui. Puro (sem env nem banco), testado em test/platform-agents.test.ts.

export type PlatformAgent = { readonly slug: string; readonly id: string };

export const PLATFORM_AGENTS: readonly PlatformAgent[] = [
  // Criador de Solvers: ajuda criadores a montar o pacote (agents/criador-de-solvers).
  { slug: "criador-de-solvers", id: "c71ad0a50f750e75c71ad0a50f750e75" },
];

/** Ids dos Solvers da plataforma (para filtros de banco). */
export const PLATFORM_AGENT_IDS: readonly string[] = PLATFORM_AGENTS.map((a) => a.id);

/** O id (32 hex) ou o slug é de um Solver da plataforma? */
export function isPlatformAgent(idOrSlug: string): boolean {
  return PLATFORM_AGENTS.some((a) => a.id === idOrSlug || a.slug === idOrSlug);
}

/** Linha de agente (banco) ou manifesto: basta ter o id. */
export function isPlatformAgentRow(row: { id: string }): boolean {
  return PLATFORM_AGENTS.some((a) => a.id === row.id);
}

/** A dupla slug+id é exatamente uma da lista? (id de um e slug de outro não valem.) */
export function isPlatformPair(m: { id: string; slug: string }): boolean {
  return PLATFORM_AGENTS.some((a) => a.id === m.id && a.slug === m.slug);
}

/**
 * Decide se um pacote do disco é da plataforma e se o carregamento deve falhar. Devolve `platform` (a autoridade é a
 * lista) ou `error` (texto em português para o log do servidor).
 * - O campo `platform: true` sem a dupla na lista: erro (ninguém se declara plataforma por conta própria).
 * - O id ou o slug da lista usados por outra dupla, ou por um pacote publicado de criador: erro.
 */
export function platformVerdict(m: { id: string; slug: string; platform?: boolean }, source: "agents" | "published"): { platform: boolean; error?: string } {
  const pair = isPlatformPair(m);
  const touchesList = PLATFORM_AGENTS.some((a) => a.id === m.id || a.slug === m.slug);
  if (touchesList && !pair) return { platform: false, error: `id or slug reserved for a platform Solver (${m.slug} / ${m.id}), but the pair does not match PLATFORM_AGENTS` };
  if (pair && source !== "agents") return { platform: false, error: `${m.slug} is a platform Solver and can only come from the platform packages folder (AGENTS_DIR)` };
  if (m.platform === true && !pair) return { platform: false, error: `the manifest declares platform: true, but ${m.slug} is not in PLATFORM_AGENTS (the server disagrees)` };
  return { platform: pair };
}

export const PLATFORM_NOT_FOR_SALE_CODE = "platform_agent_not_for_sale";
export const PLATFORM_NOT_FOR_SALE_TEXT = "This is a free platform Solver: it is not sold and has no license. Just activate it with activate_solver.";

/** Barra compra, garantia, Pix e x402 de um Solver da plataforma (409 `platform_agent_not_for_sale`). */
export function assertNotPlatformAgent(row: { id: string }): void {
  if (isPlatformAgentRow(row)) throw new HttpError(409, PLATFORM_NOT_FOR_SALE_TEXT, PLATFORM_NOT_FOR_SALE_CODE);
}

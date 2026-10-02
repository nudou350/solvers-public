import { HttpError } from "../lib/http.js";

// Disponibilidade de um especialista (PACKAGE_SPEC.md 15.4). `status` espelha a conta on-chain e o
// indexador o reescreve a cada evento; `platformStatus` é a suspensão da plataforma (kill switch) e
// NUNCA é escrita pelo indexador. Só VENDE se os dois estiverem "active"; quanto a ATENDER, `retired` ainda serve o direito pago.

export type AgentAvailabilityFields = { status: string; platformStatus: string };

export const PLATFORM_ACTIVE = "active";
export const PLATFORM_SUSPENDED = "suspended";

export function agentIsAvailable(a: AgentAvailabilityFields): boolean {
  return a.status === "active" && a.platformStatus === PLATFORM_ACTIVE;
}

export const UNAVAILABLE_TEXT = "Este especialista está temporariamente indisponível.";
export const RETIRED_TEXT = "Este especialista foi aposentado pelo criador: não está mais à venda nem tem teste grátis. Quem já tem licença ou uma tarefa com garantia aberta segue usando.";

/**
 * Quem pode ser atendido (decisão pura). `status` "retired" (criador pediu saída do depósito) continua servindo o
 * direito PAGO (licença vitalícia, garantia aberta) e nunca teste grátis nem quem não tem direito; "suspended" (cadeia)
 * ou `platformStatus` suspenso (kill switch) cortam tudo.
 */
export type ServePolicy = "all" | "paid_only" | "closed";
export type AccessKind = "license" | "guarantee" | "platform" | "trial" | "none";

export function servePolicy(a: AgentAvailabilityFields): ServePolicy {
  if (a.platformStatus !== PLATFORM_ACTIVE) return "closed";
  if (a.status === "active") return "all";
  if (a.status === "retired") return "paid_only";
  return "closed";
}

/** O teste grátis só existe para solver no ar (não aposentado, não suspenso). */
export const trialAllowed = (a: AgentAvailabilityFields): boolean => servePolicy(a) === "all";

export function agentCanServe(a: AgentAvailabilityFields, access: AccessKind): boolean {
  const p = servePolicy(a);
  // "platform": Solver gratuito da plataforma (sem licença): não é teste, então aposentado ainda serve.
  return p === "all" || (p === "paid_only" && (access === "license" || access === "guarantee" || access === "platform"));
}

export function assertAgentCanServe(a: AgentAvailabilityFields, access: AccessKind): void {
  if (agentCanServe(a, access)) return;
  throw new HttpError(403, servePolicy(a) === "paid_only" ? RETIRED_TEXT : UNAVAILABLE_TEXT, "agent_unavailable");
}

export function assertAgentAvailable(a: AgentAvailabilityFields): void {
  if (!agentIsAvailable(a)) throw new HttpError(403, UNAVAILABLE_TEXT, "agent_unavailable");
}

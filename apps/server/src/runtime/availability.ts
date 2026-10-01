import { HttpError } from "../lib/http.js";

// Disponibilidade de um especialista (PACKAGE_SPEC.md 15.4). `status` espelha a conta on-chain e o
// indexador o reescreve a cada evento; `platformStatus` é a suspensão da plataforma (kill switch) e
// NUNCA é escrita pelo indexador. Só responde/vende se os dois estiverem "active".

export type AgentAvailabilityFields = { status: string; platformStatus: string };

export const PLATFORM_ACTIVE = "active";
export const PLATFORM_SUSPENDED = "suspended";

export function agentIsAvailable(a: AgentAvailabilityFields): boolean {
  return a.status === "active" && a.platformStatus === PLATFORM_ACTIVE;
}

export const UNAVAILABLE_TEXT = "Este especialista está temporariamente indisponível.";

export function assertAgentAvailable(a: AgentAvailabilityFields): void {
  if (!agentIsAvailable(a)) throw new HttpError(403, UNAVAILABLE_TEXT, "agent_unavailable");
}

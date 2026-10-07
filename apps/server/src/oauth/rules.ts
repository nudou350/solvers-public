// Regras puras do OAuth (sem env/banco), testadas em test/oauth.test.ts.

export type RefreshTokenRow = { clientId: string; revoked: boolean; expiresAt: Date };

/**
 * O refresh token pode ser rotacionado? Valida tudo ANTES de revogar: pedido inválido (client_id errado,
 * token vencido) nunca consome o token do cliente legítimo. null = pode rotacionar.
 */
export function refreshRejection(tok: RefreshTokenRow | undefined, clientId: string | undefined, now: Date): string | null {
  if (!tok || tok.revoked || tok.expiresAt < now) return "Invalid or expired refresh token";
  if (clientId && clientId !== tok.clientId) return "Refresh token belongs to another client";
  return null;
}

/** `client_id` fixo dos tokens emitidos pelo login SIWS direto do agente (sem registro dinâmico nem linha em oauth_clients). */
export const AGENT_CLIENT_ID = "agent";

/** Statement SIWS do login do agente: a mensagem diz o que a assinatura autoriza (e o que não). */
export const AGENT_SIWS_STATEMENT = "Authorize this agent to use Solvers specialists. This does not authorize payments.";

/** O token pertence a um agente autônomo (login SIWS direto), não a um assistente de IA conectado por um humano? */
export function isAgentClient(clientId: string | null | undefined): boolean {
  return clientId === AGENT_CLIENT_ID;
}

// Regras puras do OAuth (sem env/banco), testadas em test/oauth.test.ts.

export type RefreshTokenRow = { clientId: string; revoked: boolean; expiresAt: Date };

/**
 * O refresh token pode ser rotacionado? Valida tudo ANTES de revogar: pedido inválido (client_id errado,
 * token vencido) nunca consome o token do cliente legítimo. null = pode rotacionar.
 */
export function refreshRejection(tok: RefreshTokenRow | undefined, clientId: string | undefined, now: Date): string | null {
  if (!tok || tok.revoked || tok.expiresAt < now) return "Refresh token inválido ou expirado";
  if (clientId && clientId !== tok.clientId) return "Refresh token de outro cliente";
  return null;
}

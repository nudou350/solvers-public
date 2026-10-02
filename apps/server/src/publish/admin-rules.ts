// Admin do site = carteira em ADMIN_WALLETS (separadas por vírgula), confirmada pelo login (PACKAGE_SPEC.md 14.4).
// É a permissão de revisar e concluir: NÃO é o admin on-chain (carteira fria, só os CLIs `cli:approve`/`cli:suspend`).
// Puro (sem env): testado em test/publish-rules.test.ts.

/** Carteiras admin de uma lista "a,b , c" (vazios ignorados). */
export function parseAdminWallets(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean),
  );
}

export function isAdminIn(wallet: string, raw: string): boolean {
  return parseAdminWallets(raw).has(wallet);
}

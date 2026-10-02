// Comparação "versão da cadeia x versão aprovada pela revisão" (PACKAGE_SPEC.md 15.4). Puro: sem env nem banco,
// testado em test/publish-sync.test.ts.
//
// O criador pode chamar update_version/update_pricing direto na cadeia, sem passar pela revisão. O indexador não
// copia versão, hash e preço da cadeia: confere com `agent_published_versions`. Se divergir, o espelho mantém o que
// foi aprovado (a vitrine e o pacote servido seguem o aprovado) e `agents.sync_flag` vira `unapproved_chain_version`
// (a venda é bloqueada: `price_in_review`). Quando a cadeia reverte ou uma nova aprovação cobre o hash, volta a `ok`.

export const SYNC_OK = "ok" as const;
export const SYNC_UNAPPROVED = "unapproved_chain_version" as const;
export type SyncFlag = typeof SYNC_OK | typeof SYNC_UNAPPROVED;

/** O que a conta on-chain diz sobre a versão (hash em hex minúsculo, preço em unidades de 6 casas). */
export type ChainVersion = { version: string; versionHash: string; price: bigint };

/** Uma linha de `agent_published_versions`. */
export type ApprovedVersion = { version: string; versionHash: string; priceUsdc: bigint };

/**
 * A cadeia só é "aprovada" se versão, hash E preço batem com UMA versão aprovada do agente. Versões antigas contam:
 * o criador pode reverter para uma versão que já passou pela revisão. Mudar só o preço (update_pricing) também diverge.
 */
export function chainMatchesApproved(chain: ChainVersion, approved: readonly ApprovedVersion[]): boolean {
  const hash = chain.versionHash.toLowerCase();
  return approved.some((a) => a.version === chain.version && a.versionHash.toLowerCase() === hash && a.priceUsdc === chain.price);
}

export function syncFlagFor(chain: ChainVersion, approved: readonly ApprovedVersion[]): SyncFlag {
  return chainMatchesApproved(chain, approved) ? SYNC_OK : SYNC_UNAPPROVED;
}

type Mirrorable = { version: string; versionHash: string; price: bigint };

/**
 * Aplica o veredito aos valores do espelho. Aprovado: copia tudo (inclusive versão, hash e preço) e a marca vai a `ok`.
 * Divergente: REMOVE versão, hash e preço do que será gravado (a linha existente fica como está) e levanta a marca.
 */
export function withApprovalFlag<T extends Mirrorable>(values: T, approved: readonly ApprovedVersion[]): Omit<T, "version" | "versionHash" | "price"> & Partial<Mirrorable> & { syncFlag: SyncFlag } {
  const flag = syncFlagFor(values, approved);
  if (flag === SYNC_OK) return { ...values, syncFlag: flag };
  const { version: _v, versionHash: _h, price: _p, ...rest } = values;
  return { ...rest, syncFlag: flag };
}

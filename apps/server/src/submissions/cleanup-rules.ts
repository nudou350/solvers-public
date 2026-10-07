// Regras puras da faxina das submissões (job em jobs.ts, I/O em cleanup.ts). Sem banco nem disco: testadas em
// test/submission-cleanup.test.ts. Os prazos são de PACKAGE_SPEC.md 16 (limpeza) e dos achados da revisão.

const DAY_MS = 86_400_000;

/** Rejeitadas (validação ou revisor): o ZIP e a pasta extraída saem depois deste prazo. */
export const REJECTED_FILES_TTL_DAYS = 30;
/** Pedido de mudanças ou assinatura que o criador não fez: depois deste prazo a submissão expira e o slug é liberado. */
export const STALE_OPEN_TTL_DAYS = 30;
/** Resto de upload cortado (`.part`) e pasta sem linha no banco: um dia. */
export const ORPHAN_TTL_DAYS = 1;

const REJECTED_STATUSES = ["rejected_validation", "rejected"] as const;
/** Estados que dependem do criador e podem ficar parados para sempre prendendo o slug. */
export const EXPIRABLE_STATUSES = ["changes_requested", "awaiting_creator_signature"] as const;

const olderThan = (at: Date | number, now: Date | number, days: number): boolean => new Date(now).getTime() - new Date(at).getTime() > days * DAY_MS;

/** O ZIP e a pasta extraída desta submissão já podem ser apagados? */
export function filesExpired(status: string, updatedAt: Date, now: Date = new Date()): boolean {
  return (REJECTED_STATUSES as readonly string[]).includes(status) && olderThan(updatedAt, now, REJECTED_FILES_TTL_DAYS);
}

/** Esta submissão parada deve expirar (vira `rejected` com nota "expirada", liberando o slug)? */
export function staleOpen(status: string, updatedAt: Date, now: Date = new Date()): boolean {
  return (EXPIRABLE_STATUSES as readonly string[]).includes(status) && olderThan(updatedAt, now, STALE_OPEN_TTL_DAYS);
}

/** Arquivo de upload incompleto (`package.zip.<id>.part` ou `package.zip.part`) com mais de um dia. */
export function partFileStale(name: string, mtimeMs: number, now: Date = new Date()): boolean {
  return name.endsWith(".part") && olderThan(mtimeMs, now, ORPHAN_TTL_DAYS);
}

/**
 * Pasta de submissão sem linha no banco e com mais de um dia. O upload cria a pasta ANTES de inserir a linha, então a
 * folga de um dia evita apagar um envio em andamento.
 */
export function orphanFolderStale(hasRow: boolean, mtimeMs: number, now: Date = new Date()): boolean {
  return !hasRow && olderThan(mtimeMs, now, ORPHAN_TTL_DAYS);
}

/** Nota gravada em `reviewer_notes` e em `package_reviews` quando o sistema expira uma submissão parada. */
export const EXPIRED_NOTE = "Submission expired: it sat idle for more than 30 days, waiting for the creator. The slug has been released; submit the package again if you still want to publish.";
/** Carteira que assina as ações do sistema em `package_reviews`. */
export const SYSTEM_REVIEWER = "system";

import { sha256Hex } from "../lib/crypto.js";

// Regras puras das avaliações (sem env/banco), testadas em test/review.test.ts.
// O texto fica off-chain e só vale se o sha256 dele for o content_hash confirmado on-chain.

/** O texto é o que o hash on-chain diz que é? */
export function textMatchesHash(text: string, contentHash: string): boolean {
  return sha256Hex(text) === contentHash;
}

/**
 * Escolhe o texto a publicar para o hash confirmado on-chain: o primeiro candidato (rascunho com
 * o mesmo hash, texto já publicado, vazio) cujo sha256 bate. Nenhum bate: "" (nunca texto que o
 * hash não prova, ex: avaliação feita direto na cadeia).
 */
export function resolvePublishedText(chainHash: string, candidates: Array<string | null | undefined>): string {
  for (const c of [...candidates, ""]) {
    if (typeof c === "string" && textMatchesHash(c, chainHash)) return c;
  }
  return "";
}

/** Qual licença da carteira vai provar a avaliação (a avaliação on-chain é uma por LICENÇA, não por carteira). */
export type ReviewLicenseChoice = { kind: "use"; asset: string } | { kind: "none" } | { kind: "all_used" };

/**
 * `owned`: licenças da carteira para o solver, com `used` = a conta `LicenseReview` do asset já existe. Usa a primeira
 * ainda não usada. Todas usadas: se a própria carteira já avaliou (`hasOwnReview`), mantém a primeira e deixa o programa
 * recusar com a mensagem certa (avaliação repetida); senão o limite vem de uma licença comprada usada, cuja avaliação a dona
 * anterior já gastou (`all_used`). Sem licença: `none`.
 */
export function chooseReviewLicense(owned: ReadonlyArray<{ id: string; used: boolean }>, hasOwnReview: boolean): ReviewLicenseChoice {
  if (owned.length === 0) return { kind: "none" };
  const free = owned.find((l) => !l.used);
  if (free) return { kind: "use", asset: free.id };
  return hasOwnReview ? { kind: "use", asset: owned[0]!.id } : { kind: "all_used" };
}

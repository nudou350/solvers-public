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

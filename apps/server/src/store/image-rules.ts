// Regras puras das imagens (sem env/banco), testadas em test/images.test.ts.

/** Menor posição livre em 0..max-1, ou null se a galeria já está cheia. */
export function firstFreePosition(used: number[], max: number): number | null {
  const taken = new Set(used);
  for (let p = 0; p < max; p++) if (!taken.has(p)) return p;
  return null;
}

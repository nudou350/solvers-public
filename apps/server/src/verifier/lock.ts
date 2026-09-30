// Mutex por chave, em processo: serializa o que não pode rodar ao mesmo tempo para a mesma etapa
// (escrow:idx). Quem chega depois espera a anterior terminar (com sucesso ou erro) e só então roda.

const tails = new Map<string, Promise<void>>();

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}

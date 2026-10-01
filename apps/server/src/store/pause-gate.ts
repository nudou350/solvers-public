import { PAUSE_ENTRIES } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { assertNotPaused, createConfigStateReader } from "./pause-rules.js";

// Ligação da pausa de emergência com a cadeia (regras e cache puros em `pause-rules.ts`, testáveis sem env nem rede).

const reader = createConfigStateReader({ fetch: () => chain().fetchConfigState("confirmed") });

/** `PauseChanged` no indexador: a próxima compra relê a Config. */
export function invalidatePauseCache() {
  reader.invalidate();
}

/** Chame no início das rotas que montam compra/garantia, antes de gravar algo no banco. */
export async function assertEntriesOpen(label: string): Promise<void> {
  assertNotPaused(await reader.read(), PAUSE_ENTRIES, label);
}

import { pauseDecision, type ConfigState } from "@solvers/chain";
import { HttpError } from "../lib/http.js";

/**
 * Pausa de emergência (`Config.pause_flags`, governança v2). O programa é a barreira de verdade (instrução recusada com
 * `Paused`); aqui o servidor só evita montar uma transação que vai falhar e responde antes, em português.
 *
 * Decisão pura (`assertNotPaused`) + leitura com cache curto (`createConfigStateReader`):
 * - bit de entradas ligado: 503 `platform_paused` "Purchases are temporarily paused";
 * - fail-open: Config ilegível (RPC fora, v1 ainda não migrada, tamanho desconhecido) NÃO bloqueia; o programa continua
 *   sendo a barreira e a simulação (`simulation-gate.ts`) já devolve a mensagem amigável de `Paused` como 409.
 */
export const PAUSED_MESSAGE = "Purchases are temporarily paused";

export function assertNotPaused(
  state: ConfigState | null,
  bit: number,
  label: string,
  log: (msg: string) => void = console.warn,
): void {
  const decision = pauseDecision(state, bit);
  if (decision === "paused") throw new HttpError(503, PAUSED_MESSAGE, "platform_paused");
  if (decision === "unknown") {
    log(`[pausa] ${label}: estado da pausa indisponível (${state ? `Config ${state.kind}` : "leitura falhou"}), seguindo sem bloquear`);
  }
}

export type ConfigStateReader = {
  read(): Promise<ConfigState | null>;
  /** Descarta o cache (ex.: o indexador viu `PauseChanged`). */
  invalidate(): void;
};

/**
 * Cache curto da leitura da Config: no máximo uma leitura por `ttlMs` (pedidos simultâneos compartilham a mesma),
 * e uma leitura que falhou vale só `failTtlMs` (devolve null, que o chamador trata como fail-open).
 */
export function createConfigStateReader(opts: {
  fetch: () => Promise<ConfigState>;
  ttlMs?: number;
  failTtlMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}): ConfigStateReader {
  const { fetch, ttlMs = 10_000, failTtlMs = 2_000, now = Date.now, log = console.warn } = opts;
  let cached: { at: number; ttl: number; value: ConfigState | null } | null = null;
  let inflight: Promise<ConfigState | null> | null = null;
  let generation = 0;
  return {
    read() {
      if (cached && now() - cached.at < cached.ttl) return Promise.resolve(cached.value);
      if (inflight) return inflight;
      const gen = generation;
      const p: Promise<ConfigState | null> = Promise.resolve()
        .then(fetch)
        .then(
          (value): { value: ConfigState | null; ttl: number } => ({ value, ttl: ttlMs }),
          (e: unknown) => {
            log(`[pausa] falha ao ler a Config: ${(e as Error)?.message ?? String(e)}`);
            return { value: null, ttl: failTtlMs };
          },
        )
        .then(({ value, ttl }) => {
          if (gen === generation) cached = { at: now(), ttl, value };
          if (inflight === p) inflight = null;
          return value;
        });
      inflight = p;
      return p;
    },
    invalidate() {
      generation++;
      cached = null;
      inflight = null;
    },
  };
}

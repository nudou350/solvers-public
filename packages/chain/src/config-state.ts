import { getAddressDecoder, type Address } from "@solana/kit";
import * as gen from "@solvers/client";

// Estado da conta Config (puro, sem rede): o cliente gerado só decodifica o layout v2 (285 bytes). Na devnet, entre o
// upgrade do programa e `migrate_config`, a conta ainda é v1 (187 bytes) e o decoder falha; aqui isso vira um estado
// explícito em vez de uma exceção de codec.

/** Config v1 (devnet antes da migração): 8 do discriminador + 179 de dados. */
export const CONFIG_V1_SIZE = 187;
/** Config v2 (layout atual): v1 + `layout_version`, `pause_flags`, `guardian` e 64 reservados. */
export const CONFIG_V2_SIZE = 285;

/** Bit 0: entradas (`register_agent`, `purchase_license`, `buy_credits`, `create_escrow`). */
export const PAUSE_ENTRIES = 1;
/** Bit 1: pagamentos (`release_milestone`, `mark_passed`, `resolve_dispute`). */
export const PAUSE_PAYMENTS = 2;
export const PAUSE_MASK = PAUSE_ENTRIES | PAUSE_PAYMENTS;

export type ConfigState =
  /** Conta Config inexistente (programa sem `initialize_config`). */
  | { kind: "missing" }
  /** Layout v1: `migrate_config` ainda não rodou. Toda instrução do programa que lê Config falha até lá. */
  | { kind: "v1" }
  | { kind: "v2"; config: gen.Config }
  /** Tamanho ou discriminador inesperado (programa mais novo que o servidor, conta trocada). */
  | { kind: "unknown"; size: number };

export function classifyConfigData(data: Uint8Array | null | undefined): ConfigState {
  if (!data) return { kind: "missing" };
  const disc = gen.CONFIG_DISCRIMINATOR;
  const isConfig = data.length >= disc.length && disc.every((b, i) => data[i] === b);
  if (!isConfig) return { kind: "unknown", size: data.length };
  if (data.length === CONFIG_V1_SIZE) return { kind: "v1" };
  if (data.length !== CONFIG_V2_SIZE) return { kind: "unknown", size: data.length };
  return { kind: "v2", config: gen.getConfigDecoder().decode(data) };
}

/** `fetchConfig` numa Config v1: erro claro (em vez de "esperava 285 bytes") apontando a migração. */
export class ConfigNotMigratedError extends Error {
  constructor() {
    super(`Config v1 (${CONFIG_V1_SIZE} bytes) ainda não migrada: rode "cli:admin migrate-config" (docs/devnet-upgrade.md)`);
    this.name = "ConfigNotMigratedError";
  }
}

/** "entradas, pagamentos", "nenhuma" ou "(bits inválidos: N)" para log e CLI. */
export function describePauseFlags(flags: number): string {
  const names = [flags & PAUSE_ENTRIES ? "entradas" : null, flags & PAUSE_PAYMENTS ? "pagamentos" : null].filter(Boolean);
  const extra = flags & ~PAUSE_MASK;
  return [...names, ...(extra ? [`bits inválidos: ${extra}`] : [])].join(", ") || "nenhuma";
}

/** Decisão pura da pausa para um bit. `unknown`: o estado não pôde ser lido ou não é v2 (o chamador decide; o servidor segue). */
export function pauseDecision(state: ConfigState | null, bit: number): "open" | "paused" | "unknown" {
  if (state?.kind !== "v2") return "unknown";
  return state.config.pauseFlags & bit ? "paused" : "open";
}

/**
 * Upgrade authority gravada na conta ProgramData do BPF Loader Upgradeable (bincode: variante u32 = 3, slot u64,
 * Option<Pubkey>: tag u8 + 32 bytes). `authority: null` = programa imutável. `null` na resposta = não é ProgramData.
 */
export function parseProgramDataAuthority(data: Uint8Array): { authority: Address | null } | null {
  if (data.length < 13 || data[0] !== 3 || data[1] !== 0 || data[2] !== 0 || data[3] !== 0) return null;
  const tag = data[12];
  if (tag === 0) return { authority: null };
  if (tag !== 1 || data.length < 45) return null;
  return { authority: getAddressDecoder().decode(data.slice(13, 45)) };
}

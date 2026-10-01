// Barreira pura do `cli:admin` (sem rede nem env): a rede do RPC precisa ser a devnet.

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"; // o mesmo de scripts/chain/upgrade-devnet.sh
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** Nomes aceitos por `--allow-network`: precisam bater com a rede de fato detectada. */
export type NetworkName = "devnet" | "mainnet-beta" | "desconhecida";

export function networkName(genesisHash: string): NetworkName {
  return genesisHash === DEVNET_GENESIS ? "devnet" : genesisHash === MAINNET_GENESIS ? "mainnet-beta" : "desconhecida";
}

export class NetworkError extends Error {}

/**
 * Só a devnet passa por padrão. Outra rede só com `--allow-network <nome>` IGUAL ao nome da rede detectada
 * (ex.: `--allow-network mainnet-beta` numa mainnet), para o override ser deliberado e não valer para a rede errada.
 * Devolve um aviso quando o override foi usado.
 */
export function assertNetwork(genesisHash: string, allow: string | null): { network: NetworkName; warning: string | null } {
  const network = networkName(genesisHash);
  if (network === "devnet") return { network, warning: null };
  if (allow === network) return { network, warning: `AVISO: rede ${network} liberada por --allow-network (genesis ${genesisHash}).` };
  throw new NetworkError(
    `o RPC aponta para a rede "${network}" (genesis ${genesisHash}), não para a devnet. Abortando${allow ? ` (--allow-network ${allow} não confere com a rede detectada)` : ""}. ` +
      `Se for de propósito, repita com --allow-network ${network}.`,
  );
}

export class PauseRuleError extends Error {}

/**
 * Quem assina `set-pause` e se a mudança é permitida (espelha `set_pause` do programa: o admin define qualquer
 * combinação válida; o guardian só acrescenta bits). `keyAddress` null = sem chave neste computador (dry-run do admin).
 * Recusa antes de simular/enviar, com o motivo em português.
 */
export function decidePauseSigner(input: {
  current: number;
  next: number;
  admin: string;
  /** null = sem guardian. */
  guardian: string | null;
  keyAddress: string | null;
}): { role: "admin" | "guardian"; unpausing: boolean } {
  const { current, next, admin, guardian, keyAddress } = input;
  if (keyAddress && keyAddress !== admin && keyAddress !== guardian) {
    throw new PauseRuleError(`a chave informada é de ${keyAddress}, que não é o admin (${admin}) nem o guardian (${guardian ?? "nenhum"})`);
  }
  const role = keyAddress && keyAddress !== admin ? "guardian" : "admin";
  const unpausing = (next & current) !== current;
  if (role === "guardian" && unpausing) {
    throw new PauseRuleError(`o guardian só pode LIGAR a pausa; para liberar, assine com a chave do admin (${admin})`);
  }
  if (next === current) throw new PauseRuleError("a pausa já está nesse valor: nada a fazer");
  return { role, unpausing };
}

/** Espelha `SLASH_DELAY_SECS` e `MAX_STAKE_EXIT_EXTENSIONS` do programa (state.rs). */
export const SLASH_DELAY_SECS = 72 * 3600;
export const STAKE_EXIT_EXTENSION_SECS = 30 * 86_400;
export const MAX_STAKE_EXIT_EXTENSIONS = 2;
/** Depois de `proposed_at + 72 h + 14 dias` o programa recusa `execute_slash` (`SlashExpired`) e o criador pode cancelar. */
export const SLASH_EXPIRY_GRACE_SECS = 14 * 86_400;

/** Quanto falta (em segundos, 0 = já passou) para `execute_slash` passar, e o texto "1 d 3 h 20 min" em português. */
export function slashWait(proposedAt: bigint | number, nowSecs: number): { remainingSecs: number; executableAt: number; expiresAt: number; expired: boolean; text: string } {
  const executableAt = Number(proposedAt) + SLASH_DELAY_SECS;
  const expiresAt = executableAt + SLASH_EXPIRY_GRACE_SECS;
  const expired = nowSecs > expiresAt;
  const remainingSecs = Math.max(0, executableAt - nowSecs);
  if (remainingSecs === 0) return { remainingSecs, executableAt, expiresAt, expired, text: expired ? "a proposta VENCEU (72 h + 14 dias): não dá mais para executar, só cancelar" : "a espera de 72 h já terminou" };
  const d = Math.floor(remainingSecs / 86_400);
  const h = Math.floor((remainingSecs % 86_400) / 3600);
  const m = Math.ceil((remainingSecs % 3600) / 60);
  const carry = m === 60 ? { h: h + 1, m: 0 } : { h, m };
  const parts = [d ? `${d} d` : null, carry.h ? `${carry.h} h` : null, carry.m ? `${carry.m} min` : null].filter(Boolean);
  return { remainingSecs, executableAt, expiresAt, expired, text: `faltam ${parts.join(" ")}` };
}

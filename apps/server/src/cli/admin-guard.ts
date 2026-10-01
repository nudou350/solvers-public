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

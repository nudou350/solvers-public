// Explorador da Solana e nome da rede, a partir da config pública (getConfig()).
import type { PublicConfig } from "@solvers/api-client";

type ClusterInfo = Pick<PublicConfig, "cluster" | "rpcUrl">;

const isMainnet = (c: string) => c === "mainnet-beta" || c === "mainnet";

/** Link do explorador para uma transação ou conta, com o mesmo cálculo do servidor (chain/explorerUrl). */
export function explorerLink(config: ClusterInfo, kind: "tx" | "address", value: string): string {
  const q = isMainnet(config.cluster)
    ? ""
    : config.cluster === "devnet" || config.cluster === "testnet"
      ? `?cluster=${config.cluster}`
      : `?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl ?? "http://127.0.0.1:8899")}`;
  return `https://explorer.solana.com/${kind}/${value}${q}`;
}

/** Link de uma transação a partir de um explorerUrl de conta que a API devolveu (mantém a rede). */
export function explorerTx(addressUrl: string, signature: string): string {
  return addressUrl.replace(/\/address\/[^?]+/, `/tx/${signature}`);
}

/**
 * explorerUrl que chegou por parâmetro da página (ex: /checkout/concluido?explorer=...): só vale se for
 * https no explorador da Solana. Qualquer outra coisa é descartada (quem chama cai no explorerLink).
 */
export function trustedExplorerUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "explorer.solana.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Nome da rede para as pessoas. */
export function clusterName(cluster: string): string {
  if (isMainnet(cluster)) return "Solana (rede principal)";
  if (cluster === "devnet") return "Solana Devnet (rede de testes)";
  if (cluster === "testnet") return "Solana Testnet (rede de testes)";
  return "Rede local de testes (localnet)";
}

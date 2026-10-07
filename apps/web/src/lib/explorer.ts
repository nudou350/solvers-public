// Explorador da Solana e nome da rede, a partir da config pública (getConfig()).
import type { PublicConfig } from "@solvers/api-client";
import type { Locale } from "@/i18n/routing";
import { localText } from "./local-text";

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

/**
 * Link de uma carteira de pessoa, na aba de tokens. A carteira não guarda SOL (o servidor paga as taxas),
 * então a página principal do explorador diz "Account does not exist"; o saldo em USDC está na aba de tokens.
 */
export function explorerWallet(config: ClusterInfo, wallet: string): string {
  return explorerLink(config, "address", wallet).replace(/\/address\/([^?]+)/, "/address/$1/tokens");
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

/** Nome da rede para as pessoas, no idioma da página (sem `locale`: o do navegador; componente de servidor passa o dele). */
export function clusterName(cluster: string, locale?: Locale): string {
  if (isMainnet(cluster)) return localText("cluster.mainnet", undefined, locale);
  if (cluster === "devnet") return localText("cluster.devnet", undefined, locale);
  if (cluster === "testnet") return localText("cluster.testnet", undefined, locale);
  return localText("cluster.local", undefined, locale);
}

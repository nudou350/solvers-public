export type { WalletAdapter, WalletKind, WalletLike } from "./types";
import { localText } from "../local-text";
export { createDevAdapter, forgetDevWallet, loadDevWallet } from "./dev";

/** App ID do Privy (build-time). Sem ele, a vitrine usa a carteira de desenvolvimento. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || null;

/**
 * Carteira de desenvolvimento (sem Privy): sempre no `next dev`; no build de produção, só com
 * NEXT_PUBLIC_ALLOW_DEV_WALLET=1 (demo na devnet enquanto o App ID do Privy não existe). Nunca na mainnet.
 */
export const DEV_WALLET_ALLOWED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ALLOW_DEV_WALLET === "1";

/** Motivo (no idioma da página) para recusar a carteira de desenvolvimento nesta vitrine/rede (null = pode usar). */
export function devWalletBlocked(cluster: string | null | undefined): string | null {
  if (!DEV_WALLET_ALLOWED) return localText("wallet.notConfigured");
  if (cluster === "mainnet-beta" || cluster === "mainnet") return localText("wallet.mainnetBlocked");
  return null;
}

export type { WalletAdapter, WalletKind, WalletLike } from "./types";
export { createDevAdapter, forgetDevWallet, loadDevWallet } from "./dev";

/** App ID do Privy (build-time). Sem ele, a vitrine usa a carteira de desenvolvimento. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || null;

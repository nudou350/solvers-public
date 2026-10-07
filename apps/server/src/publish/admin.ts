import { env } from "../env.js";
import { forbidden } from "../lib/http.js";
import { isAdminIn } from "./admin-rules.js";

// A carteira autenticada é admin do site? (ADMIN_WALLETS; regra em admin-rules.ts.)

export const isAdminWallet = (wallet: string): boolean => isAdminIn(wallet, env.ADMIN_WALLETS);

export function requireAdminWallet(wallet: string): void {
  if (!isAdminWallet(wallet)) throw forbidden("Only the team can do this");
}

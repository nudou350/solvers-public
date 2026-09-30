import { join } from "node:path";
import { address, loadSigner, SolversChain } from "@solvers/chain";

/** Diretório com os keypairs de desenvolvimento (fora do repositório). */
export const KEYS_DIR = process.env.KEYS_DIR ?? "//wsl.localhost/Ubuntu-24.04/home/<user>/solvers-keys";
export const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";

export const key = (name: string) => loadSigner(process.env[`KEY_${name.toUpperCase().replace("-", "_")}`] ?? join(KEYS_DIR, `${name}.json`));

export async function chain() {
  const feePayer = await key("fee-payer");
  const mint = process.env.USDC_MINT ? address(process.env.USDC_MINT) : (await key("usdc-mint")).address;
  return new SolversChain({ rpcUrl: RPC_URL, usdcMint: mint, feePayer });
}

export function log(step: string, extra?: unknown) {
  console.log(`✔ ${step}`, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

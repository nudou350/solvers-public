import { loadSigner, SolversChain, address, type KeyPairSigner } from "@solvers/chain";
import { env } from "../env.js";

export type Authorities = {
  feePayer: KeyPairSigner;
  verifier: KeyPairSigner;
  usage: KeyPairSigner;
  admin: KeyPairSigner | null;
};

let _chain: SolversChain | null = null;
let _auth: Authorities | null = null;

export async function initChain(): Promise<{ chain: SolversChain; auth: Authorities }> {
  if (_chain && _auth) return { chain: _chain, auth: _auth };
  const feePayer = await loadSigner(env.FEE_PAYER_KEYPAIR);
  _auth = {
    feePayer,
    verifier: await loadSigner(env.VERIFIER_KEYPAIR),
    usage: await loadSigner(env.USAGE_AUTHORITY_KEYPAIR),
    admin: env.ADMIN_KEYPAIR ? await loadSigner(env.ADMIN_KEYPAIR) : null,
  };
  // Custódia do x402: só existe com X402_ENABLED (env.ts já recusa mainnet e chave repetida). O endereço também não pode repetir
  // o de nenhuma outra autoridade (a chave pode vir em formatos diferentes: JSON, base58 ou arquivo).
  let custody: KeyPairSigner | undefined;
  if (env.X402_ENABLED && env.CUSTODY_KEYPAIR) {
    custody = await loadSigner(env.CUSTODY_KEYPAIR);
    const others = [_auth.feePayer, _auth.verifier, _auth.usage, _auth.admin].filter((s): s is KeyPairSigner => s !== null);
    if (others.some((s) => s.address === custody!.address)) {
      throw new Error("CUSTODY_KEYPAIR repete a carteira do fee payer, do verificador, da autoridade de uso ou do admin: a custódia é uma carteira só dela");
    }
  }
  _chain = new SolversChain({
    rpcUrl: env.SOLANA_RPC_URL,
    usdcMint: address(env.USDC_MINT),
    feePayer,
    custody,
    priorityFee: env.PRIORITY_FEE_MICROLAMPORTS,
  });
  return { chain: _chain, auth: _auth };
}

export function chain(): SolversChain {
  if (!_chain) throw new Error("chain não inicializada");
  return _chain;
}

export function authorities(): Authorities {
  if (!_auth) throw new Error("chain não inicializada");
  return _auth;
}

export function explorerUrl(kind: "tx" | "address", value: string): string {
  const cluster =
    env.SOLANA_CLUSTER === "mainnet-beta"
      ? ""
      : env.SOLANA_CLUSTER === "devnet"
        ? "?cluster=devnet"
        : `?cluster=custom&customUrl=${encodeURIComponent(env.SOLANA_RPC_URL)}`;
  return `https://explorer.solana.com/${kind}/${value}${cluster}`;
}

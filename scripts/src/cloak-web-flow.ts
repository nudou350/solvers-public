// Roda o MESMO módulo do navegador (apps/web/src/lib/cloak) no Node, com uma carteira de verdade na MAINNET.
// Prova que a derivação de chaves, o signer da carteira, o depósito, o saque e o relatório do contador funcionam
// sem a chave privada da carteira passar pelo SDK (só `signMessage` e `signTransaction`, como no navegador).
//
//   CLOAK_DRY_RUN=1 ... npx tsx src/cloak-web-flow.ts   # só confere saldos, plano e a derivação determinística das chaves
//   ... npx tsx src/cloak-web-flow.ts                    # real: deposita CLOAK_AMOUNT (padrão 1 USDC) e saca para CLOAK_DESTINATION
//
// Variáveis: SOLANA_RPC_URL (mainnet, ex: Helius), KEYPAIR_PATH (carteira descartável), CLOAK_DESTINATION (endereço).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Defina ${n}`);
  return v;
};

// O módulo é importado por caminho em variável: o tsc do pacote não tenta resolver os imports sem extensão do app web.
const web = (p: string) => import(pathToFileURL(resolve(import.meta.dirname, "../../apps/web/src/lib", p)).href) as Promise<any>;

async function main() {
  process.env.NEXT_PUBLIC_CLOAK_RPC_URL = need("SOLANA_RPC_URL");
  const secret = Uint8Array.from(JSON.parse(readFileSync(need("KEYPAIR_PATH"), "utf8")) as number[]);
  const [{ devWalletFromSeed }, cloak, shared] = await Promise.all([web("wallet/dev.ts"), web("cloak/withdraw.ts"), import("@solvers/shared")]);

  const wallet = await devWalletFromSeed(secret.slice(0, 32));
  console.log("carteira:", wallet.address);

  const balances = await cloak.getMainnetBalances(wallet.address);
  console.log("saldos:", { usdc: shared.formatUsdcBase(balances.usdc), solLamports: balances.sol.toString() });

  const keys1 = await cloak.deriveKeys(wallet);
  const keys2 = await cloak.deriveKeys(wallet);
  const same = cloak.viewingKeyHex(keys1.nk) === cloak.viewingKeyHex(keys2.nk) && keys1.owner.publicKey === keys2.owner.publicKey;
  console.log("chaves deterministicas (duas assinaturas, mesma chave):", same);
  if (!same) throw new Error("A derivacao das chaves nao e deterministica: nao use a assinatura da carteira.");

  const destination = need("CLOAK_DESTINATION");
  const plan = shared.planPrivateWithdraw({ amount: process.env.CLOAK_AMOUNT ?? "1", destination, ownAddress: wallet.address, balances });
  if (!plan.ok) throw new Error(`Plano recusado: ${plan.problem} - ${shared.PRIVATE_WITHDRAW_PROBLEM_TEXT[plan.problem]}`);
  console.log("plano:", { valor: shared.formatUsdcBase(plan.amount), taxa: shared.formatUsdcBase(plan.fee), recebe: shared.formatUsdcBase(plan.net), destino: plan.destination });
  if (process.env.CLOAK_DRY_RUN === "1") return console.log("ensaio ok: nada foi enviado");

  const t0 = Date.now();
  const result = await cloak.privateWithdraw({
    wallet,
    amount: plan.amount,
    destination: plan.destination,
    hooks: { onStep: (s: string) => console.log(`[etapa] ${s} (+${Math.round((Date.now() - t0) / 1000)}s)`), onProgress: (t: string) => console.log("   ", t) },
  });
  console.log("deposito:", `https://solscan.io/tx/${result.depositSignature}`);
  console.log("saque:   ", `https://solscan.io/tx/${result.withdrawSignature}`);

  // O contador so tem a chave de visualizacao (nk) e o destino: nao a carteira.
  const report = await cloak.buildReport({ nk: keys1.nk, destination, onStatus: (t: string) => !t.startsWith("Scanned") && console.log("   relatorio:", t) });
  console.log("resumo do relatorio:", report.summary);
  console.log(report.csv);
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});

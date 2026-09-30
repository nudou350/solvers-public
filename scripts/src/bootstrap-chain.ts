// Prepara a rede (local ou devnet): mint de USDC de teste, Config do programa e SOL das carteiras.
// Idempotente: pode rodar de novo sem quebrar.
import { chain, key, log, RPC_URL } from "./env.js";
import { usdcToUnits, MIN_PERMANENT_PRICE_USDC } from "@solvers/shared";

const FEE_BPS = Number(process.env.FEE_BPS ?? 1000);
const MIN_STAKE_USDC = Number(process.env.MIN_STAKE_USDC ?? 10);

const c = await chain();
const admin = await key("admin");
const verifier = await key("verifier");
const usage = await key("usage");
const mint = await key("usdc-mint");
log("rede", RPC_URL);

const feePayerSol = await c.solBalance(c.feePayer.address);
log("saldo do fee payer (SOL)", Number(feePayerSol) / 1e9);
if (feePayerSol < 500_000_000n) throw new Error(`Fee payer ${c.feePayer.address} precisa de SOL (faucet.solana.com)`);

// O admin assina initialize_config e paga o rent da Config.
const adminSol = await c.solBalance(admin.address);
if (adminSol < 50_000_000n) {
  await c.sendAsServer([c.transferSolIx(admin.address, 100_000_000n)]);
  log("admin abastecido com 0.1 SOL");
}

const mintInfo = await c.rpc.getAccountInfo(mint.address, { encoding: "base64" }).send();
if (!mintInfo.value) {
  await c.createTestMint(mint);
  log("mint de USDC de teste criado", mint.address);
} else log("mint de USDC já existe", mint.address);

const configAddr = await c.configPda();
const existing = await c.rpc.getAccountInfo(configAddr, { encoding: "base64" }).send();
const params = {
  verifier: verifier.address,
  usageAuthority: usage.address,
  feeBps: FEE_BPS,
  minStake: usdcToUnits(MIN_STAKE_USDC),
  minPrice: usdcToUnits(MIN_PERMANENT_PRICE_USDC),
};
if (!existing.value) {
  // A tesouraria é a ATA de USDC do admin.
  const ixs = await c.initializeConfigIxs(admin, admin.address, params);
  await c.sendAsServer(ixs);
  log("config criada", configAddr);
} else {
  await c.sendAsServer([await c.updateConfigIx(admin, params)]);
  log("config atualizada", configAddr);
}
const config = await c.fetchConfig();
log("config", { admin: config.data.admin, treasury: config.data.treasury, feeBps: config.data.feeBps, minPrice: config.data.minPrice });

console.log(`\nVariáveis para o servidor:\nSOLVERS_PROGRAM_ID=${c.programId}\nUSDC_MINT=${mint.address}\nTREASURY=${config.data.treasury}`);

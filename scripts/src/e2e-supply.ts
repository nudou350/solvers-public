// Teto de licenças ponta a ponta (docs/licencas-limitadas.md): o criador define teto 1, o comprador A compra,
// o comprador B é barrado pelo programa (SoldOut) sem mover USDC; o criador sobe o teto para 2 e B compra; baixar o teto falha.
// Exige o programa NOVO na rede (com create_supply_cap): na devnet, só depois do upgrade (docs/devnet-upgrade.md).
//   cd scripts && npx tsx src/e2e-supply.ts
import { randomBytes, createHash } from "node:crypto";
import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, partiallySignTransaction } from "@solana/kit";
import { generateKeyPairSigner, type KeyPairSigner } from "@solvers/chain";
import { bytesToHex, usdcToUnits } from "@solvers/shared";
import { chain, key, log } from "./env.js";

const c = await chain();
const admin = await key("admin");
const creator = await key("creator1");

await c.faucet(creator.address, usdcToUnits(50));
const agentId = bytesToHex(randomBytes(16));
const reg = await c.registerAgentIxs({
  creator,
  agentIdHex: agentId,
  name: "Teto de licenças",
  metadataUri: `https://solvers.example/api/agents/${agentId}/metadata.json`,
  version: "1.0.0",
  versionHash: createHash("sha256").update("pacote-teto").digest(),
  price: usdcToUnits(12),
  pricePerUse: 0n,
  royaltyBps: 500,
});
await c.sendAsServer(reg.instructions);
await c.sendAsServer([await c.approveAgentIx(admin, agentId)]);
log("solver registrado e aprovado", { agentId });

// Sem teto criado: ilimitado.
if ((await c.fetchSupplyCap(agentId)) !== null) throw new Error("solver novo não devia ter teto");

await c.sendAsServer([await c.createSupplyCapIx(creator, agentId, 1)]);
if ((await c.fetchSupplyCap(agentId)) !== 1) throw new Error("teto 1 não foi gravado");
log("teto de licenças criado", 1);

async function buyer(): Promise<KeyPairSigner> {
  const b = await generateKeyPairSigner();
  await c.faucet(b.address, usdcToUnits(30));
  return b;
}

/** Monta como o servidor (plataforma paga), o comprador assina e envia; devolve a simulação antes do envio. */
async function tryBuy(b: KeyPairSigner) {
  const { instructions, asset } = await c.purchaseLicenseIxs(b.address, agentId, usdcToUnits(12));
  const built = await c.buildForUser(instructions);
  const sim = await c.simulate(built.transaction);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
  const signed = await partiallySignTransaction([b.keyPair], tx);
  return { sim, asset, wire: getBase64EncodedWireTransaction(signed) };
}

const a = await buyer();
const bb = await buyer();

const first = await tryBuy(a);
if (!first.sim.ok) throw new Error(`a primeira compra devia passar na simulação: ${JSON.stringify(first.sim, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`);
await c.submitSigned(first.wire);
if ((await c.fetchCoreAsset(first.asset.address))?.owner !== a.address) throw new Error("licença A não está com o comprador A");
log("comprador A comprou a única vaga");

// B: o programa recusa (SoldOut) já na simulação e nada se move.
const balanceBefore = await c.usdcBalance(bb.address);
const second = await tryBuy(bb);
if (second.sim.ok || second.sim.kind !== "rejected" || second.sim.name !== "SoldOut") {
  throw new Error(`esperava SoldOut na simulação de B: ${JSON.stringify(second.sim, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`);
}
let submitted = false;
try {
  await c.submitSigned(second.wire);
  submitted = true;
} catch {
  /* esperado: o preflight também recusa */
}
if (submitted) throw new Error("a compra de B não podia entrar");
if ((await c.usdcBalance(bb.address)) !== balanceBefore) throw new Error("USDC de B se moveu");
log("comprador B barrado com SoldOut, sem mover USDC");

// O teto só sobe.
try {
  await c.sendAsServer([await c.raiseSupplyCapIx(creator, agentId, 1)]);
  throw new Error("subir para o mesmo valor devia falhar");
} catch (e) {
  if ((e as Error).message.startsWith("subir")) throw e;
}
await c.sendAsServer([await c.raiseSupplyCapIx(creator, agentId, 2)]);
log("teto subiu para", await c.fetchSupplyCap(agentId));
const third = await tryBuy(bb);
if (!third.sim.ok) throw new Error("com o teto 2 a compra de B devia passar");
await c.submitSigned(third.wire);
if ((await c.fetchCoreAsset(third.asset.address))?.owner !== bb.address) throw new Error("licença B não está com o comprador B");
log("comprador B comprou depois de o criador subir o teto");

const agent = await c.fetchAgent(agentId);
if (agent.data.totalSales !== 2n) throw new Error(`total_sales esperado 2, veio ${agent.data.totalSales}`);
console.log("\nE2E de teto de licenças OK");

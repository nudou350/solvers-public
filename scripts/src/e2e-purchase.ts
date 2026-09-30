// Compra ponta a ponta pelo terminal (INSTRUCTIONS.md fase 1):
// criador publica, admin aprova, comprador recebe USDC de teste e compra com a plataforma pagando as taxas.
import { randomBytes, createHash } from "node:crypto";
import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, partiallySignTransaction } from "@solana/kit";
import { bytesToHex, usdcToUnits, unitsToUsdc } from "@solvers/shared";
import { chain, key, log } from "./env.js";

const c = await chain();
const admin = await key("admin");
const creator = await key("creator1");
const buyer = await key("buyer1");

// O criador precisa de USDC para o stake mínimo.
await c.faucet(creator.address, usdcToUnits(50));
log("criador recebeu 50 USDC de teste");

const agentId = bytesToHex(randomBytes(16));
const reg = await c.registerAgentIxs({
  creator,
  agentIdHex: agentId,
  name: "Front-end React",
  metadataUri: `https://solvers.example/api/agents/${agentId}/metadata.json`,
  version: "1.0.0",
  versionHash: createHash("sha256").update("pacote").digest(),
  price: usdcToUnits(12),
  pricePerUse: usdcToUnits(0.5),
  royaltyBps: 500,
});
const r1 = await c.sendAsServer(reg.instructions);
log("solver registrado", { agentId, events: r1.events.map((e) => e.name) });

await c.sendAsServer([await c.approveAgentIx(admin, agentId)]);
log("solver aprovado pelo admin");

await c.faucet(buyer.address, usdcToUnits(30));
const buyerSolBefore = await c.solBalance(buyer.address);
const treasuryBefore = await c.usdcBalance(admin.address);

// Servidor monta, carteira do usuário assina (simulado aqui), servidor transmite.
const { instructions, asset } = await c.purchaseLicenseIxs(buyer.address, agentId, usdcToUnits(12));
const built = await c.buildForUser(instructions);
const tx = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
const signedByUser = await partiallySignTransaction([buyer.keyPair], tx);
const res = await c.submitSigned(getBase64EncodedWireTransaction(signedByUser));
log("compra confirmada", { signature: res.signature, events: res.events.map((e) => e.name) });

const lic = await c.fetchCoreAsset(asset.address);
if (lic?.owner !== buyer.address) throw new Error("licença não está na carteira do comprador");
const agent = await c.fetchAgent(agentId);
if (lic.collection !== agent.data.collection) throw new Error("licença fora da coleção do solver");
log("licença na carteira do comprador", { asset: asset.address, collection: lic.collection });

const found = await c.findLicenses(buyer.address, agent.data.collection).catch(() => []);
log("busca on-chain de licenças (fallback)", found);

const buyerSolAfter = await c.solBalance(buyer.address);
if (buyerSolAfter !== buyerSolBefore) throw new Error("comprador pagou SOL; deveria ser a plataforma");
log("comprador não gastou SOL", `${buyerSolAfter}`);
log("saldo USDC do comprador", unitsToUsdc(await c.usdcBalance(buyer.address)));
log("taxa recebida pela tesouraria", unitsToUsdc((await c.usdcBalance(admin.address)) - treasuryBefore));
log("vendas do solver", agent.data.totalSales);
console.log("\nE2E de compra OK");

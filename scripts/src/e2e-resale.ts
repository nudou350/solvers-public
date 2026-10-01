// Revenda de licenças ponta a ponta pelo terminal (localnet com o programa e o Metaplex Core; sem servidor):
//   criador publica e o admin aprova -> vendedor compra a licença -> ANUNCIA (list_license) -> erros esperados
//   (anunciar de novo, comprar o próprio anúncio, preço esperado errado, terceiro cancelando anúncio vivo) -> comprador COMPRA
//   (buy_listing: royalty, taxa e líquido do vendedor batem com o evento e com os saldos; total_sales intacto) -> comprador
//   anuncia de novo e CANCELA -> comprar um anúncio cancelado dá listing_not_found.
//
//   WSL:   bash scripts/chain/local-validator.sh        (precisa do solvers.so COM a revenda: scripts/chain/build-program.sh)
//   aqui:  cd scripts && pnpm bootstrap && pnpm e2e:resale
// Variáveis: SOLANA_RPC_URL, KEYS_DIR, USDC_MINT (ver env.ts). Usa as chaves admin, creator1, buyer1 (vendedor) e buyer2 (comprador).
import { randomBytes, createHash } from "node:crypto";
import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, partiallySignTransaction, type Address, type Instruction, type KeyPairSigner } from "@solana/kit";
import { ResaleError } from "@solvers/chain";
import { bytesToHex, resaleSplit, unitsToUsdc, usdcToUnits } from "@solvers/shared";
import { chain, key, log } from "./env.js";

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
}

const c = await chain();
const admin = await key("admin");
const creator = await key("creator1");
const seller = await key("buyer1");
const buyer = await key("buyer2");

/** Como a API: o servidor monta e paga as taxas, o usuário assina, o servidor transmite. */
async function send(signer: KeyPairSigner, instructions: Instruction[]) {
  const built = await c.buildForUser(instructions);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
  const signed = await partiallySignTransaction([signer.keyPair], tx);
  return c.submitSigned(getBase64EncodedWireTransaction(signed));
}

/** A montagem tem de recusar com este código de ResaleError (antes de qualquer transação). */
async function expectResaleError(what: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    check(e instanceof ResaleError, `${what}: esperava ResaleError, veio ${e}`);
    check(e.code === code, `${what}: esperava ${code}, veio ${e.code}`);
    log(`${what} recusado`, code);
    return e;
  }
  throw new Error(`FALHOU: ${what} deveria ser recusado (${code})`);
}

const tokenBalance = async (account: Address) => BigInt((await c.rpc.getTokenAccountBalance(account).send()).value.amount);

// ---------- Preparação: solver novo, aprovado, com royalty de 5% ----------
await c.faucet(creator.address, usdcToUnits(50));
const agentId = bytesToHex(randomBytes(16));
const reg = await c.registerAgentIxs({
  creator,
  agentIdHex: agentId,
  name: "Revenda E2E",
  metadataUri: `https://solvers.example/api/agents/${agentId}/metadata.json`,
  version: "1.0.0",
  versionHash: createHash("sha256").update("pacote").digest(),
  price: usdcToUnits(12),
  pricePerUse: 0n,
  royaltyBps: 500,
});
await c.sendAsServer(reg.instructions);
await c.sendAsServer([await c.approveAgentIx(admin, agentId)]);
log("solver registrado e aprovado", { agentId, royaltyBps: 500 });

await c.faucet(seller.address, usdcToUnits(40));
await c.faucet(buyer.address, usdcToUnits(40));

const purchase = await c.purchaseLicenseIxs(seller.address, agentId, usdcToUnits(12));
await send(seller, purchase.instructions);
const asset = purchase.asset.address;
check((await c.fetchCoreAsset(asset))?.owner === seller.address, "a licença deveria estar com o vendedor");
const salesAfterPurchase = (await c.fetchAgent(agentId)).data.totalSales;
log("vendedor comprou a licença", { asset, totalSales: salesAfterPurchase });

const config = await c.fetchConfig();
const agentAcc = await c.fetchAgent(agentId);
const price = usdcToUnits(20);

// ---------- Anunciar ----------
const listIx = await c.listLicenseIxs(seller.address, asset, price, { agentIdHex: agentId });
const listed = await send(seller, listIx.instructions);
check(listed.events.some((e) => e.name === "LicenseListed"), "faltou o evento LicenseListed");
const listing = await c.fetchMaybeListing(asset);
check(listing && listing.price === price && listing.seller === seller.address, "Listing on-chain não confere");
check(listing.feeBps === config.data.feeBps && listing.royaltyBps === 500, "fee/royalty não ficaram congelados no anúncio");
const core = await c.fetchCoreLicense(asset);
check(core?.owner === seller.address, "o vendedor deve manter a licença (e o acesso) enquanto anunciada");
check(core.transferDelegate?.kind === "Address" && core.transferDelegate.address === (await c.marketAuthorityPda()), "TransferDelegate deveria ser a PDA do mercado");
log("anunciada por 20 USDC; vendedor mantém a licença", { listing: listIx.listing, feeBps: listing.feeBps, royaltyBps: listing.royaltyBps });

// ---------- Erros esperados ----------
await expectResaleError("anunciar de novo", "already_listed", () => c.listLicenseIxs(seller.address, asset, price, { agentIdHex: agentId }));
await expectResaleError("comprar o próprio anúncio", "own_listing", () => c.buyListingIxs(seller.address, asset, price));
const changed = await expectResaleError("preço esperado errado", "listing_changed", () => c.buyListingIxs(buyer.address, asset, usdcToUnits(19)));
check((changed as ResaleError).details.priceUnits === price, "listing_changed deveria trazer o preço atual");
await expectResaleError("terceiro cancelando anúncio vivo", "not_owner", () => c.cancelListingIxs(buyer.address, asset));

// ---------- Comprar ----------
const split = resaleSplit(price, 500, config.data.feeBps);
const creatorBefore = await tokenBalance(agentAcc.data.creatorUsdc);
const treasuryBefore = await tokenBalance(config.data.treasury);
const sellerBefore = await c.usdcBalance(seller.address);
const buyerBefore = await c.usdcBalance(buyer.address);
const bought = await c.buyListingIxs(buyer.address, asset, price);
check(bought.royaltyUnits === split.royalty && bought.feeUnits === split.fee && bought.sellerUnits === split.seller, "divisão do cliente difere de resaleSplit");
const sold = await send(buyer, bought.instructions);
const resold = sold.events.find((e) => e.name === "LicenseResold");
check(resold && resold.name === "LicenseResold", "faltou o evento LicenseResold");
const ev = resold.data;
check(ev.price === price && ev.royalty === split.royalty && ev.fee === split.fee && ev.sellerAmount === split.seller, "evento difere de resaleSplit");
check(ev.royalty + ev.fee + ev.sellerAmount === ev.price, "partes do evento não somam o preço");
check((await c.usdcBalance(buyer.address)) === buyerBefore - price, "o comprador deveria pagar exatamente o preço");
check((await c.usdcBalance(seller.address)) === sellerBefore + split.seller, "vendedor recebeu o valor errado");
check((await tokenBalance(agentAcc.data.creatorUsdc)) === creatorBefore + split.royalty, "criador recebeu o royalty errado");
check((await tokenBalance(config.data.treasury)) === treasuryBefore + split.fee, "tesouraria recebeu a taxa errada");
check((await c.fetchCoreAsset(asset))?.owner === buyer.address, "a licença deveria ter mudado para o comprador");
check((await c.fetchMaybeListing(asset)) === null, "o Listing deveria ter sido fechado");
check((await c.fetchAgent(agentId)).data.totalSales === salesAfterPurchase, "revenda não pode mexer em total_sales");
log("venda concluída", { royalty: unitsToUsdc(split.royalty), fee: unitsToUsdc(split.fee), seller: unitsToUsdc(split.seller) });
await expectResaleError("comprar de novo (anúncio fechado)", "listing_not_found", () => c.buyListingIxs(buyer.address, asset, price));

// ---------- Anunciar de novo e cancelar ----------
const relist = await c.listLicenseIxs(buyer.address, asset, usdcToUnits(15), { agentIdHex: agentId });
await send(buyer, relist.instructions);
check((await c.fetchMaybeListing(asset))?.price === usdcToUnits(15), "o novo dono deveria conseguir anunciar de novo (Listing por asset reaproveitado)");
const cancel = await c.cancelListingIxs(buyer.address, asset);
check(cancel.stale === false, "o anúncio vivo não é velho");
const cancelled = await send(buyer, cancel.instructions);
check(cancelled.events.some((e) => e.name === "ListingCancelled"), "faltou o evento ListingCancelled");
check((await c.fetchMaybeListing(asset)) === null, "o Listing deveria ter sido fechado pelo cancelamento");
check((await c.fetchCoreAsset(asset))?.owner === buyer.address, "cancelar não muda o dono");
const afterCancel = await c.fetchCoreLicense(asset);
check(afterCancel?.transferDelegate === null || afterCancel?.transferDelegate?.kind !== "Address", "o delegate deveria ter sido revogado");
await expectResaleError("comprar anúncio cancelado", "listing_not_found", () => c.buyListingIxs(seller.address, asset, usdcToUnits(15)));

console.log("\nE2E de revenda OK");

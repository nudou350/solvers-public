import { HttpError, badRequest } from "../lib/http.js";

/** Regra pura: o que impede esta carteira de comprar? (null = pode). Sem banco nem RPC. */
export function purchaseBlock(input: { wallet: string; creatorWallet: string | null; ownedAssetId: string | null }): HttpError | null {
  if (input.ownedAssetId) {
    return new HttpError(409, "You already have this specialist's license.", "already_owned", { assetId: input.ownedAssetId });
  }
  if (input.creatorWallet && input.creatorWallet === input.wallet) {
    return badRequest("The specialist's creator can't buy their own license.", "creator_cannot_buy");
  }
  return null;
}

/**
 * Regra pura: só se vende o que a vitrine lista E tem pacote carregável no servidor. Um agente Active na cadeia cuja
 * publicação falhou (`publish_failed`, `listed = false`, sem pasta em disco) cobraria por algo que não dá para entregar.
 */
export function notListedBlock(input: { listed: boolean; hasPackage: boolean }): HttpError | null {
  if (input.listed && input.hasPackage) return null;
  return new HttpError(409, "This specialist is not available in the catalog yet.", "agent_not_listed");
}

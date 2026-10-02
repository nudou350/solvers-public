import { HttpError, badRequest } from "../lib/http.js";

/** Regra pura: o que impede esta carteira de comprar? (null = pode). Sem banco nem RPC. */
export function purchaseBlock(input: { wallet: string; creatorWallet: string | null; ownedAssetId: string | null }): HttpError | null {
  if (input.ownedAssetId) {
    return new HttpError(409, "Você já tem a licença deste especialista.", "already_owned", { assetId: input.ownedAssetId });
  }
  if (input.creatorWallet && input.creatorWallet === input.wallet) {
    return badRequest("O criador do especialista não pode comprar a própria licença.", "creator_cannot_buy");
  }
  return null;
}

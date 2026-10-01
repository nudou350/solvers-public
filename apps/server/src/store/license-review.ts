import { address } from "@solvers/chain";
import { findLicenseReviewPda } from "@solvers/client";
import { chain } from "../chain/index.js";

/**
 * A conta `LicenseReview` (PDA por asset) existe? Ela marca que aquela licença já foi usada numa avaliação, por qualquer dono:
 * numa licença comprada usada, a dona anterior pode ter gasto a avaliação. RPC fora do ar: devolve false (segue como "não
 * usada"; a simulação da transação pelo programa recusa se estiver).
 */
export async function licenseReviewUsed(asset: string): Promise<boolean> {
  try {
    const [pda] = await findLicenseReviewPda({ licenseAsset: address(asset) });
    const { value } = await chain().rpc.getAccountInfo(pda, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }).send();
    return value !== null;
  } catch (e) {
    console.warn(`[review] não consegui checar LicenseReview de ${asset}:`, (e as Error).message);
    return false;
  }
}

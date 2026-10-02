import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { refreshLicenseOwner } from "../indexer/sync.js";
import { purchaseBlock } from "./purchase-rules.js";

type AgentRow = typeof schema.agents.$inferSelect;

/** Licença do solver que a carteira ainda possui (confere o dono on-chain; transferida/revendida não conta). */
async function ownedLicenseId(wallet: string, agentId: string): Promise<string | null> {
  const rows = await db
    .select({ id: schema.licenses.id, owner: schema.licenses.ownerWallet })
    .from(schema.licenses)
    .where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, agentId)));
  for (const r of rows) {
    // RPC fora do ar: vale o dono do banco (bloquear uma compra duplicada custa menos que cobrar duas vezes).
    const owner = await refreshLicenseOwner(r.id).catch(() => r.owner);
    if (owner === wallet) return r.id;
  }
  return null;
}

/**
 * Guardas de compra, usadas por POST /tx/purchase e pela rota x402 (antes de liquidar o pagamento).
 * Lança HttpError 409 `already_owned` (com `assetId`) ou 400 `creator_cannot_buy`.
 */
export async function assertCanPurchase(wallet: string, agent: AgentRow): Promise<void> {
  const [creator] = await db.select({ wallet: schema.creators.wallet }).from(schema.creators).where(eq(schema.creators.id, agent.creatorId));
  const block = purchaseBlock({ wallet, creatorWallet: creator?.wallet ?? null, ownedAssetId: await ownedLicenseId(wallet, agent.id) });
  if (block) throw block;
}

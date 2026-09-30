import { unitsToUsdc } from "@solvers/shared";
import { chain } from "../chain/index.js";
import { syncAgent } from "../indexer/sync.js";
import { HttpError } from "../lib/http.js";
import type { schema } from "../db/index.js";

type PricedAgent = Pick<typeof schema.agents.$inferSelect, "id" | "price">;

/**
 * Relê o preço on-chain antes de montar uma compra. O criador pode mudar o preço (update_pricing) e o
 * programa não emite evento para isso, então o banco pode estar defasado. Se diferir, espelha o agente
 * e responde 409 com o novo preço, para o comprador confirmar o valor real em vez de a compra falhar
 * na rede com PriceChanged.
 */
export async function assertFreshPrice(row: PricedAgent): Promise<void> {
  const acc = await chain().fetchMaybeAgent(row.id);
  if (!acc.exists || acc.data.price === row.price) return;
  await syncAgent(acc.address);
  throw new HttpError(409, "O preço deste especialista mudou. Confira o novo valor para continuar.", "price_changed", {
    priceUsdc: unitsToUsdc(acc.data.price),
    previousPriceUsdc: unitsToUsdc(row.price),
  });
}

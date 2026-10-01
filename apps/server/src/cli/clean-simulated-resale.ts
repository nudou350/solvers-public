// Limpa os dados de revenda INVENTADOS pelo seed antigo (anúncios em licenses.listed_for_resale / resale_price e o
// histórico da tabela resale_prices). Os anúncios reais vivem na tabela `listings` e NÃO são tocados.
//
//   pnpm --filter @solvers/server cli:clean-simulated-resale          simulação: só lista o que seria limpo (padrão)
//   pnpm --filter @solvers/server cli:clean-simulated-resale --yes    aplica: UPDATE licenses ... e DELETE FROM resale_prices
//
// Faça `pg_dump` antes e confirme com o dono do banco antes de rodar com --yes (docs/resale.md, docs/devnet-upgrade.md passo 7a).
// Uma licença com anúncio ATIVO real em `listings` não é limpa: o sinal dela é verdadeiro.

import { and, eq, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/index.js";

async function main() {
  const apply = process.argv.slice(2).includes("--yes");
  const l = schema.licenses;

  const realActive = db.select({ id: schema.listings.licenseId }).from(schema.listings).where(eq(schema.listings.status, "active"));
  const simulated = and(or(eq(l.listedForResale, true), isNotNull(l.resalePrice)), notInArray(l.id, realActive));

  const rows = await db.select({ id: l.id, agentId: l.agentId, owner: l.ownerWallet, price: l.resalePrice }).from(l).where(simulated);
  const [prices] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.resalePrices);
  console.log(`licenças com anúncio simulado: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.id} agente=${r.agentId} dono=${r.owner} preço=${r.price == null ? "-" : Number(r.price) / 1e6} USDC`);
  console.log(`linhas em resale_prices (histórico inventado): ${prices?.n ?? 0}`);

  if (!apply) {
    console.log("\nSimulação: nada foi alterado. Rode com --yes para limpar (faça pg_dump antes).");
    return;
  }
  const cleared = await db.update(l).set({ listedForResale: false, resalePrice: null }).where(simulated).returning({ id: l.id });
  const removed = await db.delete(schema.resalePrices).returning({ id: schema.resalePrices.id });
  console.log(`\nLimpo: ${cleared.length} licenças e ${removed.length} linhas de resale_prices.`);
}

try {
  await main();
} finally {
  await pool.end();
}
process.exit(0);

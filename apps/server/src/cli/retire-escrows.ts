// Aposenta tarefas com garantia (escrows) que não existem mais na cadeia ou estão no layout v1
// (tamanho diferente de ESCROW_ACCOUNT_SIZE; o cliente v2 decodifica a conta v1 sem erro, mas com campos lixo)
// do programa (contas criadas pelo programa v1, descartadas no upgrade).
//
//   pnpm --filter @solvers/server cli:retire-escrows          dry-run: só lista e imprime o que faria (padrão)
//   pnpm --filter @solvers/server cli:retire-escrows --yes    aplica
//
// Olha os escrows do banco com closed = false e lê cada conta na cadeia (SOMENTE LEITURA no RPC):
//   - conta ausente ou ilegível (layout antigo) e status ativo/pendente/em disputa
//       -> status = "refunded" e closed = true
//   - conta ausente e status já final (approved/refunded) -> só closed = true
//   - conta legível no layout v2 -> não mexe
// Nunca apaga linhas: escrows e etapas continuam no banco para histórico. As etapas não são alteradas.
// Não envia transação nenhuma e não roda migrações.

import { and, eq } from "drizzle-orm";
import { address } from "@solvers/chain";
import { chain, initChain } from "../chain/index.js";
import { db, pool, schema } from "../db/index.js";
import { retirementPlan, type ChainVerdict } from "../indexer/escrow-status.js";

async function verdict(id: string): Promise<ChainVerdict> {
  // O cliente v2 decodifica a conta v1 sem erro: o layout se reconhece pelo tamanho (fetchEscrowLayout).
  // Erro de RPC propaga: não decide nada com informação incompleta.
  const layout = await chain().fetchEscrowLayout(address(id));
  return layout.kind === "ok" ? "ok" : layout.kind === "missing" ? "gone" : "legacy";
}

async function main() {
  const apply = process.argv.includes("--yes");
  await initChain();
  const rows = await db.select().from(schema.escrows).where(eq(schema.escrows.closed, false));
  console.log(`${rows.length} escrows abertos no banco${apply ? "" : " (dry-run: nada será alterado; use --yes para aplicar)"}`);
  let changed = 0;
  for (const r of rows) {
    const v = await verdict(r.id);
    const plan = retirementPlan(r.status, v);
    if (!plan) {
      console.log(`  mantém   ${r.id}  status=${r.status}  cadeia=${v}`);
      continue;
    }
    console.log(`  ${apply ? "aposenta" : "aposentaria"} ${r.id}  status=${r.status} -> ${plan.status ?? r.status}, closed=true  (cadeia: ${v === "gone" ? "conta não existe" : "layout antigo"})`);
    if (apply) {
      await db.update(schema.escrows).set(plan).where(and(eq(schema.escrows.id, r.id), eq(schema.escrows.closed, false)));
    }
    changed++;
  }
  console.log(`${changed} ${apply ? "aposentados" : "seriam aposentados"}`);
}

if (/cli\/retire-escrows\.(ts|js)$/.test(process.argv[1]?.replace(/\\/g, "/") ?? "")) {
  try {
    await main();
  } finally {
    await pool.end();
  }
  process.exit(0);
}

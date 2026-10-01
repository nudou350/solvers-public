// Reprocesso manual do indexador (recuperação de transações que o polling/webhook não conseguiu indexar).
//
//   pnpm --filter @solvers/server cli:reindex --dead              devolve as pendências "dead" à fila e tenta agora
//   pnpm --filter @solvers/server cli:reindex --sig <assinatura>  reprocessa uma ou mais assinaturas
//   pnpm --filter @solvers/server cli:reindex --recent 500        reprocessa as últimas N transações do programa
//   pnpm --filter @solvers/server cli:reindex --backfill          completa chain_txs sem horário do bloco / valores (inclui vendas da revenda)
//   pnpm --filter @solvers/server cli:reindex --listings          reconcilia anúncios de revenda (tabela listings) com as contas Listing on-chain
//
// Tudo é idempotente: o espelho é reconstruído do estado on-chain e chain_txs é completado sem duplicar.

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { getBase58Decoder } from "@solana/kit";
import type { Address, Signature } from "@solvers/chain";
import { LISTING_DISCRIMINATOR } from "@solvers/client";
import { chain, initChain } from "../chain/index.js";
import { db, pool, schema } from "../db/index.js";
import { reprocessSignatures, retryFailures, reviveDeadFailures } from "../indexer/processor.js";
import { syncListing } from "../indexer/sync.js";

async function recentSignatures(limit: number): Promise<string[]> {
  const c = chain();
  const out: string[] = [];
  let before: Signature | undefined;
  while (out.length < limit) {
    const page = await c.rpc
      .getSignaturesForAddress(c.programId, { limit: Math.min(1000, limit - out.length), before, commitment: "confirmed" })
      .send();
    if (page.length === 0) break;
    for (const s of page) if (!s.err) out.push(s.signature);
    before = page[page.length - 1]!.signature;
  }
  return out.reverse(); // da mais antiga para a mais nova
}

/** Assinaturas de chain_txs sem horário do bloco, ou de compras/liberações/revendas ainda sem valores executados (creator_amount nulo; inclui etapas sem dinheiro, que só são relidas à toa). */
async function backfillSignatures(): Promise<string[]> {
  const t = schema.chainTxs;
  const rows = await db
    .select({ signature: t.signature })
    .from(t)
    .where(
      or(
        isNull(t.blockTime),
        and(sql`${t.kind} in ('purchase', 'credits', 'milestone', 'dispute_resolved', 'resale')`, isNull(t.creatorAmount)),
      ),
    )
    .orderBy(asc(t.createdAt));
  return rows.map((r) => r.signature);
}

/**
 * Reconcilia `listings` com a cadeia: relê cada conta Listing do programa (cria/atualiza o anúncio ativo) e cada anúncio
 * ativo do banco (conta ausente = 'invalid'). Não recupera royalty/taxa de vendas passadas: isso vem dos eventos
 * (`--recent N` reprocessa as transações; `--backfill` completa o que ficou sem valores).
 */
async function reconcileListings(): Promise<{ onchain: number; mirrored: number; failed: number }> {
  const c = chain();
  const accounts = await c.rpc
    .getProgramAccounts(c.programId, {
      encoding: "base64",
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 0n, bytes: getBase58Decoder().decode(Uint8Array.from(LISTING_DISCRIMINATOR)) as never, encoding: "base58" } }],
    })
    .send();
  const addrs = new Set<string>(accounts.map((a) => a.pubkey));
  const active = await db.select({ addr: schema.listings.listingAddress }).from(schema.listings).where(eq(schema.listings.status, "active"));
  for (const a of active) addrs.add(a.addr);
  let failed = 0;
  for (const a of addrs) {
    try {
      await syncListing(a as Address);
    } catch (e) {
      failed++;
      console.warn(`listing ${a}: ${(e as Error).message}`);
    }
  }
  return { onchain: accounts.length, mirrored: addrs.size - failed, failed };
}

async function main() {
  const args = process.argv.slice(2);
  await initChain();
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => args[args.indexOf(name) + 1];
  let did = false;

  if (flag("--dead")) {
    did = true;
    const revived = await reviveDeadFailures();
    console.log(`${revived} pendências "dead" voltaram para a fila`);
    console.log(`${await retryFailures(500)} resolvidas agora`);
  }
  if (flag("--sig")) {
    did = true;
    const sigs = args.slice(args.indexOf("--sig") + 1).filter((a) => !a.startsWith("--"));
    console.log("assinaturas:", await reprocessSignatures(sigs));
  }
  if (flag("--recent")) {
    did = true;
    const n = Math.max(1, Math.min(10_000, Number(value("--recent")) || 200));
    console.log(`últimas ${n} transações:`, await reprocessSignatures(await recentSignatures(n)));
  }
  if (flag("--backfill")) {
    did = true;
    const sigs = await backfillSignatures();
    console.log(`backfill de chain_txs: ${sigs.length} transações`, await reprocessSignatures(sigs));
  }
  if (flag("--listings")) {
    did = true;
    console.log("anúncios de revenda:", await reconcileListings());
  }
  if (!did) console.log("uso: cli:reindex [--dead] [--sig <assinatura>...] [--recent N] [--backfill] [--listings]");
}

try {
  await main();
} finally {
  await pool.end();
}
process.exit(0);

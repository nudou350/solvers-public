import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Base64EncodedWireTransaction } from "@solana/kit";
import { address, isDefinitelyNotLanded, type Signature, type SignedTx } from "@solvers/chain";
import * as gen from "@solvers/client";
import { authorities, chain } from "./chain/index.js";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { staleDisputeDue } from "./indexer/escrow-status.js";
import { processSignature } from "./indexer/processor.js";
import { syncEscrow } from "./indexer/sync.js";
import { DISPUTE_SLA_SECS } from "./store/delivery-rules.js";
import { randomId, sha256 } from "./lib/crypto.js";
import { notifyCreator } from "./notify/telegram.js";
import { reconcilePixCredits } from "./pix/credit.js";
import { DELIST_MAX_RATING, DELIST_MIN_REVIEWS } from "@solvers/shared";

// Jobs periódicos:
// - auto release (a cada minuto): etapas aprovadas nos testes cujo prazo venceu são pagas ao criador.
// - fechamento de escrows encerrados (devolve o rent à plataforma).
// - lote de usos verificados (a cada 10 min): record_usage_batch com raiz Merkle dos recibos.
// - disputas paradas (a cada 60 s): resolve_stale_dispute devolve ao comprador depois de 7 dias sem julgamento.
// - Pix (a cada 30 s): credita cobranças pagas que ficaram sem crédito e conclui as "crediting".
// - vitrine (a cada hora): tira especialistas com nota baixa depois de 10 avaliações.

export async function autoReleaseOnce(): Promise<number> {
  if (!env.AUTO_RELEASE_ENABLED) return 0;
  const due = await db
    .select({ escrowId: schema.milestones.escrowId, idx: schema.milestones.idx })
    .from(schema.milestones)
    .innerJoin(schema.escrows, eq(schema.escrows.id, schema.milestones.escrowId))
    .where(
      and(
        eq(schema.milestones.status, "passed"),
        isNotNull(schema.milestones.passedAt),
        // Escrow fechado não tem mais o que liberar (a conta on-chain sumiu).
        eq(schema.escrows.closed, false),
        sql`${schema.milestones.passedAt} + make_interval(secs => ${schema.escrows.reviewWindowSecs}) < now()`,
      ),
    )
    // Os mais antigos primeiro: um grupo de etapas travadas não deixa as mais velhas de fora.
    .orderBy(asc(schema.milestones.passedAt))
    .limit(20);
  const c = chain();
  let n = 0;
  for (const m of due) {
    try {
      const { signature } = await c.sendAsServer(await c.releaseMilestoneIxs(c.feePayer, address(m.escrowId), m.idx));
      await processSignature(signature);
      n++;
    } catch (e) {
      console.error(`[jobs] auto release ${m.escrowId}#${m.idx}:`, (e as Error).message);
    }
  }
  return n;
}

/**
 * Disputas paradas: passados DISPUTE_SLA_SECS (7 dias) sem julgamento, o comprador é reembolsado por
 * resolve_stale_dispute, que qualquer carteira pode chamar (aqui, o servidor paga a taxa). Só vale para etapa
 * que nunca passou nos testes e cujo prazo de entrega venceu; se já passou, só o admin julga.
 *
 * Não precisa de assinatura persistida como o Pix/lotes: a instrução só vale para etapa ainda "Disputed" na
 * conta on-chain, então um reenvio depois de um envio incerto falha sem efeito. Antes de enviar, relê a
 * conta: se a etapa já não está em disputa (reembolsada/aprovada, por este job ou por outro), só espelha.
 */
export async function resolveStaleDisputesOnce(): Promise<number> {
  const due = await db
    .select({ escrowId: schema.milestones.escrowId, idx: schema.milestones.idx })
    .from(schema.milestones)
    .innerJoin(schema.escrows, eq(schema.escrows.id, schema.milestones.escrowId))
    .where(
      and(
        eq(schema.milestones.status, "disputed"),
        isNotNull(schema.milestones.disputedAt),
        // Só etapa que nunca passou nos testes e com prazo de entrega vencido (regra do programa v2).
        isNull(schema.milestones.passedAt),
        isNotNull(schema.escrows.deliveryDeadline),
        sql`${schema.escrows.deliveryDeadline} < now()`,
        eq(schema.escrows.closed, false),
        sql`${schema.milestones.disputedAt} + make_interval(secs => ${DISPUTE_SLA_SECS}) <= now()`,
      ),
    )
    .orderBy(asc(schema.milestones.disputedAt))
    .limit(10);
  const c = chain();
  let n = 0;
  for (const m of due) {
    try {
      const addr = address(m.escrowId);
      const layout = await c.fetchEscrowLayout(addr);
      if (layout.kind === "legacy") continue; // layout v1: lixo nos campos novos; fica para cli:retire-escrows
      const onchain = layout.kind === "ok" ? layout.data.milestones[m.idx] : undefined;
      if (!onchain || onchain.status !== gen.MilestoneStatus.Disputed) {
        await syncEscrow(addr); // já resolvida (ou escrow fechado): só alinha o espelho
        continue;
      }
      // O programa manda: etapa que já passou nos testes só o admin julga; o relógio e o prazo de entrega também contam.
      const now = Math.floor(Date.now() / 1000);
      if (layout.kind !== "ok" || !staleDisputeDue({ disputedAt: onchain.disputedAt, passedAt: onchain.passedAt, deliveryDeadline: layout.data.deliveryDeadline }, now)) continue;
      const { signature } = await c.sendAsServer(await c.resolveStaleDisputeIxs(c.feePayer, addr, m.idx));
      await processSignature(signature).catch(() => undefined);
      n++;
    } catch (e) {
      console.error(`[jobs] disputa parada ${m.escrowId}#${m.idx}:`, (e as Error).message);
    }
  }
  return n;
}

export async function closeFinishedOnce(): Promise<number> {
  const done = await db
    .select()
    .from(schema.escrows)
    .where(and(inArray(schema.escrows.status, ["approved", "refunded"]), eq(schema.escrows.closed, false)))
    .limit(10);
  const c = chain();
  let n = 0;
  for (const e of done) {
    try {
      const layout = await c.fetchEscrowLayout(address(e.id));
      if (layout.kind === "legacy") continue; // layout v1: não dá para fechar; cli:retire-escrows encerra no banco
      if (layout.kind === "missing") {
        await db.update(schema.escrows).set({ closed: true }).where(eq(schema.escrows.id, e.id));
        continue;
      }
      await c.sendAsServer(await c.closeEscrowIxs(c.feePayer, address(e.id)));
      await db.update(schema.escrows).set({ closed: true }).where(eq(schema.escrows.id, e.id));
      n++;
    } catch (err) {
      console.error(`[jobs] fechar escrow ${e.id}:`, (err as Error).message);
    }
  }
  return n;
}

/** Raiz Merkle simples (sha256, pares ordenados) dos hashes das respostas. */
export function merkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32);
  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1] ?? a;
      next.push(sha256(Buffer.compare(a, b) <= 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a])));
    }
    level = next;
  }
  return level[0]!;
}

// ---------- Lote de usos ----------
//
// Cada lote é uma transação on-chain que soma `count` em verified_uses e não é idempotente. Por isso a
// transação é assinada e gravada em usage_batches (com a assinatura) ANTES de ser enviada, e os usos só
// são liberados para um novo lote quando é certo que ela não entrou (recusada, falhou ou expirou).
// Uma confirmação incerta (timeout, erro de rede) deixa o lote "pending" e a reconciliação decide.

const BATCH_STALE_SECS = 30;

async function finalizeBatch(batchId: string) {
  await db.transaction(async (tx) => {
    await tx.update(schema.usageEvents).set({ batched: true }).where(eq(schema.usageEvents.batchId, batchId));
    await tx.update(schema.usageBatches).set({ status: "confirmed", updatedAt: new Date() }).where(eq(schema.usageBatches.id, batchId));
  });
}

/** Não entrou na rede: devolve os usos para o próximo lote. */
async function releaseBatch(batchId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.usageEvents)
      .set({ batchId: null })
      .where(and(eq(schema.usageEvents.batchId, batchId), eq(schema.usageEvents.batched, false)));
    await tx.update(schema.usageBatches).set({ status: "released", updatedAt: new Date() }).where(eq(schema.usageBatches.id, batchId));
  });
}

/** Confirmou: fecha o lote e dá ao indexador a chance de espelhar os eventos. */
async function confirmBatch(batchId: string, signature: string) {
  await finalizeBatch(batchId);
  await processSignature(signature).catch(() => undefined);
}

/** Retoma lotes "pending" parados (falha depois do envio, reinício do processo, timeout de confirmação). */
export async function reconcileUsageBatches(): Promise<number> {
  const b = schema.usageBatches;
  const stale = sql`${b.updatedAt} < now() - make_interval(secs => ${BATCH_STALE_SECS})`;
  const rows = await db.select().from(b).where(and(eq(b.status, "pending"), stale)).limit(20);
  const c = chain();
  let n = 0;
  for (const row of rows) {
    try {
      // Reserva atômica: outra instância não retoma o mesmo lote ao mesmo tempo.
      const [leased] = await db
        .update(b)
        .set({ updatedAt: new Date() })
        .where(and(eq(b.id, row.id), eq(b.status, "pending"), stale))
        .returning();
      if (!leased) continue;
      const tx: SignedTx = {
        signature: row.signature as Signature,
        wire: row.wire as Base64EncodedWireTransaction,
        lastValidBlockHeight: Number(row.lastValidHeight),
      };
      const outcome = await c.signatureOutcome(tx.signature, tx.lastValidBlockHeight);
      if (outcome === "confirmed") {
        await confirmBatch(row.id, row.signature);
        n += row.count;
      } else if (outcome === "failed" || outcome === "expired") {
        await releaseBatch(row.id);
      } else {
        // Ainda pode entrar: retransmite a MESMA transação (nunca monta outra) e espera o desfecho.
        await c.sendSigned(tx, { events: false, resume: true });
        await confirmBatch(row.id, row.signature);
        n += row.count;
      }
    } catch (e) {
      if (isDefinitelyNotLanded(e)) await releaseBatch(row.id).catch(() => undefined);
      console.error(`[jobs] retomada do lote ${row.id}:`, (e as Error).message);
    }
  }
  return n;
}

/** Usos por licença, garantia ou teste grátis, em lote on-chain (record_usage_batch). */
export async function recordUsageBatchOnce(): Promise<number> {
  let total = await reconcileUsageBatches();
  const rows = await db
    .select({ id: schema.usageEvents.id, agentId: schema.usageEvents.agentId, hash: schema.usageEvents.responseHash, sessionId: schema.usageEvents.sessionId })
    .from(schema.usageEvents)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.usageEvents.sessionId))
    .where(
      and(
        eq(schema.usageEvents.tool, "activate_solver"),
        eq(schema.usageEvents.batched, false),
        isNull(schema.usageEvents.batchId),
        inArray(schema.sessions.access, ["license", "guarantee", "trial"]),
        lt(schema.usageEvents.createdAt, sql`now() - interval '10 seconds'`),
      ),
    )
    .limit(1000);
  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) if (r.agentId) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
  const c = chain();
  for (const [agentId, list] of byAgent) {
    const batchId = `batch_${randomId(8)}`;
    const ids = list.map((l) => l.id);
    let tx: SignedTx;
    try {
      const root = merkleRoot(list.map((l) => Buffer.from(l.hash ?? "", "hex")));
      const ix = await c.recordUsageBatchIx(authorities().usage, agentId, BigInt(list.length), root);
      tx = await c.signServerTx([ix]);
      // Reserva os usos E grava a transação assinada de uma vez: sem assinatura gravada não há reserva.
      await db.transaction(async (dbtx) => {
        const claimed = await dbtx
          .update(schema.usageEvents)
          .set({ batchId })
          .where(and(inArray(schema.usageEvents.id, ids), isNull(schema.usageEvents.batchId), eq(schema.usageEvents.batched, false)))
          .returning({ id: schema.usageEvents.id });
        if (claimed.length !== ids.length) throw new Error("usos já reservados por outro lote");
        await dbtx.insert(schema.usageBatches).values({
          id: batchId,
          agentId,
          count: list.length,
          merkleRoot: root.toString("hex"),
          signature: tx.signature,
          wire: tx.wire,
          lastValidHeight: BigInt(tx.lastValidBlockHeight),
        });
      });
    } catch (e) {
      // Nada foi enviado nem reservado: a próxima rodada tenta de novo.
      console.error(`[jobs] preparo do lote de usos ${agentId}:`, (e as Error).message);
      continue;
    }
    try {
      await c.sendSigned(tx, { events: false });
    } catch (e) {
      if (isDefinitelyNotLanded(e)) await releaseBatch(batchId);
      // Incerto (timeout, rede): o lote fica "pending" e reconcileUsageBatches resolve pela assinatura.
      console.error(`[jobs] lote de usos ${agentId} (${batchId}):`, (e as Error).message);
      continue;
    }
    try {
      await confirmBatch(batchId, tx.signature);
    } catch (e) {
      // Confirmado, mas o banco falhou: o lote segue "pending" e a reconciliação o fecha (a rede já contou).
      console.error(`[jobs] lote ${batchId} confirmado, falha ao fechar no banco:`, (e as Error).message);
    }
    total += list.length;
  }
  return total;
}

/**
 * Qualidade da vitrine: especialista com nota média abaixo de DELIST_MAX_RATING depois de
 * DELIST_MIN_REVIEWS avaliações sai da vitrine (continua funcionando para quem já comprou).
 */
export async function delistLowRatedOnce(): Promise<number> {
  const rows = await db
    .update(schema.agents)
    .set({ listed: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.agents.listed, true),
        sql`${schema.agents.ratingCount} >= ${DELIST_MIN_REVIEWS}`,
        sql`${schema.agents.ratingSum}::float / nullif(${schema.agents.ratingCount}, 0) < ${DELIST_MAX_RATING}`,
      ),
    )
    .returning({ id: schema.agents.id, name: schema.agents.name });
  for (const r of rows) {
    void notifyCreator(r.id, `Solvers: "${r.name}" saiu da vitrine porque a nota média ficou abaixo de ${DELIST_MAX_RATING}. Quem já comprou continua usando normalmente.`);
  }
  return rows.length;
}

function every(ms: number, name: string, fn: () => Promise<number>) {
  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  return {
    start() {
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const n = await fn();
          if (n > 0) console.log(`[jobs] ${name}: ${n}`);
        } catch (e) {
          console.error(`[jobs] ${name}:`, (e as Error).message);
        } finally {
          busy = false;
        }
      }, ms);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

export const jobs = [
  every(60_000, "auto release", async () => (await autoReleaseOnce()) + (await closeFinishedOnce())),
  every(60_000, "disputas paradas", resolveStaleDisputesOnce),
  every(10 * 60_000, "lote de usos", recordUsageBatchOnce),
  every(30_000, "pix: créditos pendentes", reconcilePixCredits),
  every(60 * 60_000, "vitrine: nota baixa", delistLowRatedOnce),
];

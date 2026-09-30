import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { address } from "@solvers/chain";
import * as gen from "@solvers/client";
import { authorities, chain } from "./chain/index.js";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { processSignature } from "./indexer/processor.js";
import { randomId, sha256 } from "./lib/crypto.js";
import { notifyCreator } from "./notify/telegram.js";
import { DELIST_MAX_RATING, DELIST_MIN_REVIEWS } from "@solvers/shared";

// Jobs periódicos:
// - auto release (a cada minuto): etapas aprovadas nos testes cujo prazo venceu são pagas ao criador.
// - fechamento de escrows encerrados (devolve o rent à plataforma).
// - lote de usos verificados (a cada 10 min): record_usage_batch com raiz Merkle dos recibos.
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
        sql`${schema.milestones.passedAt} + make_interval(secs => ${schema.escrows.reviewWindowSecs}) < now()`,
      ),
    )
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
      const acc = await gen.fetchMaybeEscrow(c.rpc, address(e.id));
      if (!acc.exists) {
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

/** Usos por licença/teste (créditos já contam on-chain no consume_credit). */
export async function recordUsageBatchOnce(): Promise<number> {
  const rows = await db
    .select({ id: schema.usageEvents.id, agentId: schema.usageEvents.agentId, hash: schema.usageEvents.responseHash, sessionId: schema.usageEvents.sessionId })
    .from(schema.usageEvents)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.usageEvents.sessionId))
    .where(
      and(
        eq(schema.usageEvents.tool, "activate_solver"),
        eq(schema.usageEvents.batched, false),
        isNull(schema.usageEvents.batchId),
        inArray(schema.sessions.access, ["license", "trial"]),
        lt(schema.usageEvents.createdAt, sql`now() - interval '10 seconds'`),
      ),
    )
    .limit(1000);
  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) if (r.agentId) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
  const c = chain();
  let total = 0;
  for (const [agentId, list] of byAgent) {
    // Marca o lote ANTES de enviar: se a transação confirmar e o processo cair, não reenvia.
    // Um lote que ficar marcado sem confirmação é revisado manualmente (usage_events.batch_id).
    const batchId = `batch_${randomId(8)}`;
    const ids = list.map((l) => l.id);
    await db.update(schema.usageEvents).set({ batchId }).where(inArray(schema.usageEvents.id, ids));
    try {
      const root = merkleRoot(list.map((l) => Buffer.from(l.hash ?? "", "hex")));
      const ix = await c.recordUsageBatchIx(authorities().usage, agentId, BigInt(list.length), root);
      const { signature } = await c.sendAsServer([ix]);
      await db.update(schema.usageEvents).set({ batched: true }).where(inArray(schema.usageEvents.id, ids));
      await processSignature(signature).catch(() => undefined);
      total += list.length;
    } catch (e) {
      const msg = (e as Error).message;
      // Falhou antes de chegar à rede: libera o lote para a próxima rodada. Timeout de confirmação
      // fica marcado (a transação pode ter entrado) para não contar em dobro.
      if (!/expirou|Tempo esgotado/.test(msg)) {
        await db.update(schema.usageEvents).set({ batchId: null }).where(inArray(schema.usageEvents.id, ids));
      }
      console.error(`[jobs] lote de usos ${agentId} (${batchId}):`, msg);
    }
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
  every(10 * 60_000, "lote de usos", recordUsageBatchOnce),
  every(60 * 60_000, "vitrine: nota baixa", delistLowRatedOnce),
];

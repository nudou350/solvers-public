import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { OPEN_ESCROW_STATUSES } from "./access-rules.js";
import type { GuaranteeTask } from "./guarantee-text.js";

/** Tarefas com garantia abertas da carteira (mais recente primeiro), opcionalmente de um só especialista. */
export async function openGuarantees(wallet: string, agentId?: string): Promise<GuaranteeTask[]> {
  const rows = await db
    .select()
    .from(schema.escrows)
    .where(
      and(
        eq(schema.escrows.buyerWallet, wallet),
        eq(schema.escrows.closed, false),
        inArray(schema.escrows.status, [...OPEN_ESCROW_STATUSES]),
        agentId ? eq(schema.escrows.agentId, agentId) : undefined,
      ),
    )
    .orderBy(desc(schema.escrows.createdAt))
    .limit(10);
  if (rows.length === 0) return [];
  const ms = await db
    .select()
    .from(schema.milestones)
    .where(inArray(schema.milestones.escrowId, rows.map((r) => r.id)))
    .orderBy(asc(schema.milestones.idx));
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    title: r.title,
    description: r.description,
    deliveryDeadline: r.deliveryDeadline,
    milestones: ms.filter((m) => m.escrowId === r.id).map((m) => ({ idx: m.idx, title: m.title, criteria: m.criteria, verify: m.verify, status: m.status, amount: m.amount })),
  }));
}

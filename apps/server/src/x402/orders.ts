import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { randomId } from "../lib/crypto.js";
import { canTransition, type OrderStatus } from "./rules.js";

export type OrderRow = typeof schema.x402Orders.$inferSelect;
type OrderPatch = Partial<Omit<typeof schema.x402Orders.$inferInsert, "id" | "status">>;

const t = schema.x402Orders;

/** Id da ordem: `ord_` + 24 hex. Também é o memo do pagamento (curto: o memo do SVM tem limite de bytes). */
export const newOrderId = () => `ord_${randomId(12)}`;

export async function createOrder(input: { agentId: string; price: bigint; ttlSecs: number; clientIp: string | null }): Promise<OrderRow> {
  const [row] = await db
    .insert(t)
    .values({
      id: newOrderId(),
      agentId: input.agentId,
      price: input.price,
      clientIp: input.clientIp,
      expiresAt: new Date(Date.now() + input.ttlSecs * 1000),
    })
    .returning();
  return row!;
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  return row ?? null;
}

/** Ordens ainda abertas (sem pagamento e não vencidas) abertas por este IP: a rota sem pagamento escreve no banco. */
export async function countOpenOrders(clientIp: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(t)
    .where(and(eq(t.clientIp, clientIp), eq(t.status, "created"), sql`${t.expiresAt} > now()`));
  return r?.n ?? 0;
}

/** Log estruturado de cada transição (nunca o payload do pagamento nem chaves). */
function logMove(order: string, from: OrderStatus | OrderStatus[], to: OrderStatus, signature?: string | null) {
  console.log(`[x402] order=${order} from=${Array.isArray(from) ? from.join("|") : from} to=${to}${signature ? ` sig=${signature}` : ""}`);
}

/**
 * Transição atômica: só muda se a ordem ainda está em (um dos) `from`. Devolve a linha nova, ou `null` se outra
 * chamada chegou antes (é assim que um pagamento por ordem vence e que duas instâncias não retomam a mesma ordem).
 * Uma transição fora da máquina de estados é erro de programação e lança.
 */
export async function move(id: string, from: OrderStatus | OrderStatus[], to: OrderStatus, patch: OrderPatch = {}): Promise<OrderRow | null> {
  const froms = Array.isArray(from) ? from : [from];
  for (const f of froms) {
    if (!canTransition(f, to)) throw new Error(`transição inválida da ordem: ${f} -> ${to}`);
  }
  const [row] = await db
    .update(t)
    .set({ ...patch, status: to, updatedAt: new Date() })
    .where(and(eq(t.id, id), inArray(t.status, froms)))
    .returning();
  if (row) logMove(id, froms, to, patch.paySignature ?? patch.mintSignature ?? patch.refundSignature);
  return row ?? null;
}

/** Atualiza campos sem mudar o estado, só enquanto a ordem continua em `status` (a reserva ainda é nossa). */
export async function patchWhile(id: string, status: OrderStatus, patch: OrderPatch): Promise<OrderRow | null> {
  const [row] = await db
    .update(t)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(t.id, id), eq(t.status, status)))
    .returning();
  return row ?? null;
}

/** Marca o último contato (reserva de retomada pelo reconciliador: outra instância não pega a mesma ordem junto). */
export async function lease(id: string, status: OrderStatus, staleSecs: number): Promise<OrderRow | null> {
  const [row] = await db
    .update(t)
    .set({ updatedAt: new Date() })
    .where(and(eq(t.id, id), eq(t.status, status), sql`${t.updatedAt} < now() - make_interval(secs => ${staleSecs})`))
    .returning();
  return row ?? null;
}

export async function ordersIn(statuses: OrderStatus[], staleSecs: number, limit = 20): Promise<OrderRow[]> {
  return db
    .select()
    .from(t)
    .where(and(inArray(t.status, statuses), sql`${t.updatedAt} < now() - make_interval(secs => ${staleSecs})`))
    .orderBy(t.updatedAt)
    .limit(limit);
}

/** Ordens `created` vencidas viram `expired`. */
export async function expireStale(): Promise<number> {
  const rows = await db
    .update(t)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(t.status, "created"), sql`${t.expiresAt} <= now()`))
    .returning({ id: t.id });
  for (const r of rows) logMove(r.id, "created", "expired");
  return rows.length;
}

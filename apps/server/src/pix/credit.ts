import { and, eq, inArray, sql } from "drizzle-orm";
import type { Base64EncodedWireTransaction } from "@solana/kit";
import { address, isDefinitelyNotLanded, type SignedTx, type Signature } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";

// Crédito do USDC de teste de uma cobrança Pix paga, idempotente mesmo com falha no meio.
//
// A emissão é uma transação on-chain que o banco não consegue desfazer. Por isso NUNCA fica dentro de
// uma transação do banco: o fluxo é
//   approved -> crediting (reserva)  ->  assina e GRAVA assinatura + transação  ->  envia  ->  credited.
// Se algo cair depois da gravação, a mesma transação assinada é consultada (ou reenviada) em vez de
// emitir outra, e só volta para "approved" quando é certo que ela não entrou (recusada, falhou ou expirou).

type Row = typeof schema.pixCharges.$inferSelect;

/** Tempo parado em "crediting"/"approved" antes de o job de reconciliação assumir a cobrança. */
const STALE_SECS = 60;

/** Pago: pending/expired/failed -> approved (um Pix pago depois de "expirar" localmente ainda vale). */
export async function markApproved(id: string) {
  await db
    .update(schema.pixCharges)
    .set({ status: "approved", updatedAt: new Date() })
    .where(and(eq(schema.pixCharges.id, id), inArray(schema.pixCharges.status, ["pending", "expired", "failed"])));
}

async function markCredited(id: string) {
  await db
    .update(schema.pixCharges)
    .set({ status: "credited", updatedAt: new Date() })
    .where(and(eq(schema.pixCharges.id, id), eq(schema.pixCharges.status, "crediting")));
}

/** Só chamar quando é certo que a transação gravada não entrou (nem vai entrar). */
async function revertToApproved(id: string) {
  await db
    .update(schema.pixCharges)
    .set({ status: "approved", creditSignature: null, creditWire: null, creditLastValidHeight: null, updatedAt: new Date() })
    .where(and(eq(schema.pixCharges.id, id), eq(schema.pixCharges.status, "crediting")));
}

/** Envia (ou retoma) a transação gravada e fecha a cobrança. Erro "incerto" mantém "crediting". */
async function deliver(id: string, tx: SignedTx, resume: boolean) {
  try {
    await chain().sendSigned(tx, { events: false, resume });
  } catch (e) {
    if (isDefinitelyNotLanded(e)) await revertToApproved(id);
    throw e;
  }
  await markCredited(id);
}

/**
 * Credita uma cobrança "approved". Chamadas concorrentes são seguras: só uma consegue a reserva.
 * Se a confirmação for incerta (timeout), a cobrança fica "crediting" e o job `reconcilePixCredits` resolve.
 */
export async function credit(id: string): Promise<void> {
  const [row] = await db
    .update(schema.pixCharges)
    .set({ status: "crediting", updatedAt: new Date() })
    .where(and(eq(schema.pixCharges.id, id), eq(schema.pixCharges.status, "approved")))
    .returning();
  if (!row) return;
  let tx: SignedTx;
  try {
    tx = await chain().signFaucetTx(address(row.wallet), row.amountUsdc);
    // Só grava se a reserva ainda é nossa: se a assinatura demorou e a reconciliação já devolveu a
    // cobrança para "approved", enviar agora poderia emitir duas vezes.
    const saved = await db
      .update(schema.pixCharges)
      .set({
        creditSignature: tx.signature,
        creditWire: tx.wire,
        creditLastValidHeight: BigInt(tx.lastValidBlockHeight),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.pixCharges.id, id), eq(schema.pixCharges.status, "crediting")))
      .returning({ id: schema.pixCharges.id });
    if (saved.length === 0) return; // a reserva foi perdida: nada foi enviado; quem a tem agora cuida do crédito
  } catch (e) {
    // Nada foi enviado ainda: devolve para nova tentativa.
    await revertToApproved(id).catch(() => undefined);
    throw e;
  }
  await deliver(id, tx, false);
}

/** Retoma uma cobrança "crediting" parada, pela transação que foi gravada. */
async function resolveCrediting(row: Row): Promise<boolean> {
  if (!row.creditSignature || !row.creditWire || row.creditLastValidHeight == null) {
    // A assinatura é gravada antes de qualquer envio: sem ela, nada foi transmitido.
    await revertToApproved(row.id);
    return false;
  }
  const tx: SignedTx = {
    signature: row.creditSignature as Signature,
    wire: row.creditWire as Base64EncodedWireTransaction,
    lastValidBlockHeight: Number(row.creditLastValidHeight),
  };
  const outcome = await chain().signatureOutcome(tx.signature, tx.lastValidBlockHeight);
  if (outcome === "confirmed") {
    await markCredited(row.id);
    return true;
  }
  if (outcome === "failed" || outcome === "expired") {
    await revertToApproved(row.id);
    return false;
  }
  await deliver(row.id, tx, true);
  return true;
}

/**
 * Job: credita cobranças pagas que ficaram sem crédito (webhook sem ninguém consultando, falha do RPC,
 * reinício do processo) e conclui as que ficaram "crediting". Devolve quantas foram creditadas.
 */
export async function reconcilePixCredits(): Promise<number> {
  const stale = sql`${schema.pixCharges.updatedAt} < now() - make_interval(secs => ${STALE_SECS})`;
  const rows = await db
    .select()
    .from(schema.pixCharges)
    .where(and(inArray(schema.pixCharges.status, ["approved", "crediting"]), stale))
    .limit(10);
  let n = 0;
  for (const r of rows) {
    try {
      if (r.status === "approved") {
        await credit(r.id);
        n++;
        continue;
      }
      // Reserva atômica da retomada: outra instância não processa a mesma cobrança ao mesmo tempo.
      const [leased] = await db
        .update(schema.pixCharges)
        .set({ updatedAt: new Date() })
        .where(and(eq(schema.pixCharges.id, r.id), eq(schema.pixCharges.status, "crediting"), stale))
        .returning();
      if (leased && (await resolveCrediting(leased))) n++;
    } catch (e) {
      console.error("[pix] reconciliação do crédito falhou", r.id, (e as Error).message);
    }
  }
  return n;
}

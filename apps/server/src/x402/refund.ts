import type { Base64EncodedWireTransaction } from "@solana/kit";
import { address, isDefinitelyNotLanded, type Signature, type SignedTx } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { getOrder, move, patchWhile, type OrderRow } from "./orders.js";

// Reembolso do USDC de uma ordem paga cuja licença não pôde ser emitida (docs/x402-agentes.md, 6.7).
//
// Invariantes (é dinheiro de terceiros na custódia):
// - Idempotente: a ordem passa a `refunding` por transição atômica antes de qualquer envio; a transação de devolução é assinada
//   e GRAVADA antes de ser enviada (reenviar a mesma nunca devolve duas vezes) e só se refaz quando é certo que não entrou.
// - Nunca devolve enquanto a emissão ainda pode entrar na rede (o agente ficaria com a licença E com o dinheiro).
// - O destino é sempre o pagador gravado na própria ordem; nenhuma rota recebe endereço do cliente.

export type RefundResult =
  /** USDC devolvido (ou confirmado como já devolvido). */
  | { status: "refunded"; signature: string }
  /** A licença já está com o pagador (ou a emissão confirmou): NÃO se reembolsa; o chamador conclui a emissão. */
  | { status: "fulfilled" }
  /** Ainda não é possível decidir/concluir (rede incerta, emissão em aberto): a reconciliação retoma. */
  | { status: "pending"; reason: string };

/** A licença da ordem já está na carteira do pagador? */
async function licenseDelivered(order: OrderRow): Promise<boolean> {
  if (!order.asset || !order.payer) return false;
  const core = await chain().fetchCoreLicense(address(order.asset));
  return core?.owner === order.payer;
}

function alert(order: string, what: string, e?: unknown) {
  console.error(`[x402][ALERTA] ordem ${order}: ${what}${e ? ` (${(e as Error).message})` : ""}`);
}

/**
 * Inicia (ou retoma) o reembolso de uma ordem `paid`, `minting` ou `refunding`.
 * `neverSent`: a transação de emissão foi montada mas NUNCA transmitida (recusada na simulação): descarta-a e reembolsa já.
 */
export async function refundOrder(orderId: string, reason: string, opts: { neverSent?: boolean } = {}): Promise<RefundResult> {
  let row = await getOrder(orderId);
  if (!row) return { status: "pending", reason: "ordem não encontrada" };
  if (row.status === "refunded") return { status: "refunded", signature: row.refundSignature ?? "" };
  if (row.status === "minted") return { status: "fulfilled" };

  if (row.status === "paid" || row.status === "minting") {
    if (!opts.neverSent) {
      // A licença pode já estar no destino mesmo que a ordem não saiba (confirmação perdida): nesse caso não se reembolsa.
      if (await licenseDelivered(row)) return { status: "fulfilled" };
      if (row.mintSignature && row.mintLastValidHeight != null) {
        const outcome = await chain().signatureOutcome(row.mintSignature as Signature, Number(row.mintLastValidHeight));
        if (outcome === "confirmed") return { status: "fulfilled" };
        if (outcome === "pending") return { status: "pending", reason: "a emissão ainda pode entrar na rede" };
      }
    }
    const moved = await move(orderId, row.status, "refunding", {
      error: reason.slice(0, 500),
      ...(opts.neverSent ? { mintWire: null, mintLastValidHeight: null } : {}),
    });
    if (!moved) return { status: "pending", reason: "a ordem mudou de estado" };
    row = moved;
  } else if (row.status !== "refunding") {
    return { status: "pending", reason: `estado ${row.status} não é reembolsável` };
  }
  return sendRefund(row);
}

/** Envia (ou retoma) a transação de devolução da ordem `refunding`. */
export async function sendRefund(row: OrderRow): Promise<RefundResult> {
  const c = chain();
  if (!row.payer) {
    alert(row.id, "ordem sem pagador gravado: reembolso manual");
    return { status: "pending", reason: "sem pagador" };
  }
  try {
    let tx: SignedTx | null = null;
    if (row.refundSignature && row.refundWire && row.refundLastValidHeight != null) {
      const saved: SignedTx = {
        signature: row.refundSignature as Signature,
        wire: row.refundWire as Base64EncodedWireTransaction,
        lastValidBlockHeight: Number(row.refundLastValidHeight),
      };
      const outcome = await c.signatureOutcome(saved.signature, saved.lastValidBlockHeight);
      if (outcome === "confirmed") return markRefunded(row.id, saved.signature);
      if (outcome === "pending") {
        // Ainda pode entrar: retransmite a MESMA transação (nunca monta outra) e espera o desfecho.
        await c.sendSigned(saved, { events: false, resume: true });
        return markRefunded(row.id, saved.signature);
      }
      // Falhou ou expirou: é certo que não entrou, dá para refazer.
      await patchWhile(row.id, "refunding", { refundSignature: null, refundWire: null, refundLastValidHeight: null });
    }
    tx = await c.refundUsdcTx(address(row.payer), row.price);
    const saved = await patchWhile(row.id, "refunding", {
      refundSignature: tx.signature,
      refundWire: tx.wire,
      refundLastValidHeight: BigInt(tx.lastValidBlockHeight),
    });
    if (!saved) return { status: "pending", reason: "a reserva do reembolso foi perdida" };
    try {
      await c.sendSigned(tx, { events: false });
    } catch (e) {
      if (isDefinitelyNotLanded(e)) {
        await patchWhile(row.id, "refunding", { refundSignature: null, refundWire: null, refundLastValidHeight: null });
      }
      throw e;
    }
    return markRefunded(row.id, tx.signature);
  } catch (e) {
    // Permanece `refunding`: a reconciliação repete. Nunca descartar.
    alert(row.id, "reembolso não concluído, será repetido", e);
    return { status: "pending", reason: (e as Error).message };
  }
}

async function markRefunded(id: string, signature: string): Promise<RefundResult> {
  await move(id, "refunding", "refunded", { refundSignature: signature });
  return { status: "refunded", signature };
}

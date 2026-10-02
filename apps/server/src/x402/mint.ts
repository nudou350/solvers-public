import type { Base64EncodedWireTransaction } from "@solana/kit";
import { address, isDefinitelyNotLanded, TxError, type Signature, type SignedTx } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { env } from "../env.js";
import { processSignature } from "../indexer/processor.js";
import { syncLicense } from "../indexer/sync.js";
import { getOrder, move, patchWhile, type OrderRow } from "./orders.js";
import { refundOrder, type RefundResult } from "./refund.js";

// Emissão da licença de uma ordem paga (docs/x402-agentes.md, 6.6): a custódia compra pelo programa e transfere o NFT ao
// pagador numa única transação. Como o envio não se desfaz, a transação é assinada e GRAVADA antes de ser enviada; se algo
// cair depois, a mesma transação é consultada/retransmitida em vez de emitir outra licença.

export type FulfilResult =
  | { status: "minted"; asset: string; mintSignature: string }
  | { status: "refunded"; refundSignature: string; reason: string }
  /** Sem desfecho agora (rede incerta, reembolso a repetir): a reconciliação conclui. */
  | { status: "pending"; reason: string };

function alert(order: string, what: string, e?: unknown) {
  console.error(`[x402][ALERTA] ordem ${order}: ${what}${e ? ` (${(e as Error).message})` : ""}`);
}

/** Emite a licença de uma ordem `paid`. Chamadas concorrentes são seguras: só uma consegue a reserva. */
export async function fulfilOrder(orderId: string): Promise<FulfilResult> {
  const row = await move(orderId, "paid", "minting");
  if (!row) {
    const now = await getOrder(orderId);
    if (now?.status === "minted" && now.asset && now.mintSignature) return { status: "minted", asset: now.asset, mintSignature: now.mintSignature };
    return { status: "pending", reason: "a ordem já está sendo processada" };
  }
  return attemptMint(row);
}

/** Uma tentativa de emissão de uma ordem `minting` ainda sem transação gravada. */
export async function attemptMint(row: OrderRow): Promise<FulfilResult> {
  const c = chain();
  if (!row.payer) {
    alert(row.id, "ordem paga sem pagador gravado");
    return { status: "pending", reason: "sem pagador" };
  }
  let built: Awaited<ReturnType<typeof c.custodyMintFor>>;
  try {
    built = await c.custodyMintFor(address(row.payer), row.agentId, row.price);
  } catch (e) {
    // Nada foi assinado nem enviado: a reconciliação tenta de novo e, passado o prazo, reembolsa.
    await patchWhile(row.id, "minting", { error: (e as Error).message.slice(0, 500) });
    return { status: "pending", reason: (e as Error).message };
  }
  const { asset, signed } = built;
  // Só grava se a reserva ainda é nossa (a reconciliação pode ter assumido a ordem enquanto assinávamos).
  const saved = await patchWhile(row.id, "minting", {
    asset,
    mintSignature: signed.signature,
    mintWire: signed.wire,
    mintLastValidHeight: BigInt(signed.lastValidBlockHeight),
    error: null,
  });
  if (!saved) return { status: "pending", reason: "a reserva da emissão foi perdida" };

  if (env.X402_TEST_FAIL_MINT) {
    // Gancho do e2e: como se o programa recusasse a emissão. A transação nunca é enviada.
    const r = await refundOrder(row.id, "emissão falha induzida (X402_TEST_FAIL_MINT)", { neverSent: true });
    return refunded(row.id, r, "falha induzida");
  }

  const sim = await c.simulate(signed.wire);
  if (!sim.ok && sim.kind === "rejected") {
    // O programa recusaria (preço mudou, solver suspenso, pausa...): nada foi enviado, devolve o dinheiro.
    return refunded(row.id, await refundOrder(row.id, `emissão recusada na simulação: ${sim.message}`, { neverSent: true }), sim.message);
  }
  // infra/failed: segue (fail-open, como store/tx-build.ts); o envio tem o próprio preflight.

  try {
    await c.sendSigned(signed, { events: false });
  } catch (e) {
    if (isDefinitelyNotLanded(e)) {
      // `rejected` = recusada no preflight: nunca foi transmitida, devolve já. `failed`/`expired`: entrou e falhou / venceu.
      const neverSent = e instanceof TxError && e.phase === "rejected";
      return refunded(row.id, await refundOrder(row.id, `emissão não entrou na rede: ${(e as Error).message}`, { neverSent }), (e as Error).message);
    }
    // Incerto (timeout, rede): fica `minting`; a reconciliação consulta a assinatura gravada.
    alert(row.id, "envio da emissão incerto, a reconciliação decide", e);
    return { status: "pending", reason: (e as Error).message };
  }
  return finalizeMinted(saved, signed.signature);
}

/** Confirmada: indexa, confere que a licença é do pagador e fecha a ordem. */
export async function finalizeMinted(row: OrderRow, signature: string): Promise<FulfilResult> {
  if (!row.asset || !row.payer) return { status: "pending", reason: "ordem sem asset" };
  try {
    // O indexador espelha o evento; o `syncLicense` direto garante a linha no banco antes de responder (o agente já "vale" ao receber 200).
    await processSignature(signature).catch((e) => console.error(`[x402] indexação de ${signature}:`, (e as Error).message));
    const owner = await syncLicense(address(row.asset), row.agentId, signature);
    if (owner !== row.payer) {
      alert(row.id, `licença ${row.asset} está com ${owner} e não com o pagador ${row.payer}`);
      return { status: "pending", reason: "dono da licença diferente do pagador" };
    }
    await move(row.id, "minting", "minted", { asset: row.asset });
    return { status: "minted", asset: row.asset, mintSignature: signature };
  } catch (e) {
    // Confirmada na rede, mas o espelho falhou: segue `minting` e a reconciliação fecha (a rede já contou).
    alert(row.id, "emissão confirmada, falha ao fechar a ordem", e);
    return { status: "pending", reason: (e as Error).message };
  }
}

/** Retoma uma ordem `minting` parada pela transação gravada. */
export async function resumeMint(row: OrderRow): Promise<FulfilResult> {
  if (!row.mintSignature || !row.mintWire || row.mintLastValidHeight == null) {
    return { status: "pending", reason: "sem transação gravada" };
  }
  const tx: SignedTx = {
    signature: row.mintSignature as Signature,
    wire: row.mintWire as Base64EncodedWireTransaction,
    lastValidBlockHeight: Number(row.mintLastValidHeight),
  };
  const c = chain();
  const outcome = await c.signatureOutcome(tx.signature, tx.lastValidBlockHeight);
  if (outcome === "confirmed") return finalizeMinted(row, tx.signature);
  if (outcome === "failed" || outcome === "expired") {
    return refunded(row.id, await refundOrder(row.id, `emissão ${outcome === "failed" ? "falhou" : "expirou"} na rede`), outcome);
  }
  try {
    await c.sendSigned(tx, { events: false, resume: true });
  } catch (e) {
    if (isDefinitelyNotLanded(e)) return refunded(row.id, await refundOrder(row.id, `emissão não entrou na rede: ${(e as Error).message}`), (e as Error).message);
    return { status: "pending", reason: (e as Error).message };
  }
  return finalizeMinted(row, tx.signature);
}

/** Traduz o resultado do reembolso no desfecho da ordem. */
export function refunded(orderId: string, r: RefundResult, reason: string): FulfilResult {
  if (r.status === "refunded") return { status: "refunded", refundSignature: r.signature, reason };
  if (r.status === "fulfilled") {
    // A licença já está com o pagador (confirmação perdida): fecha como emitida no próximo ciclo da reconciliação.
    return { status: "pending", reason: "a licença já foi emitida; concluindo" };
  }
  return { status: "pending", reason: r.reason || `reembolso da ordem ${orderId} pendente` };
}

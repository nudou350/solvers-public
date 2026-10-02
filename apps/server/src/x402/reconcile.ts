import type { Signature } from "@solana/kit";
import { chain } from "../chain/index.js";
import { env } from "../env.js";
import { attemptMint, fulfilOrder, resumeMint } from "./mint.js";
import { expireStale, lease, move, ordersIn, type OrderRow } from "./orders.js";
import { refundOrder, sendRefund } from "./refund.js";
import { decideStalledMint, orderExpired, STALE_SECS } from "./rules.js";

// Reconciliação mínima (docs/x402-agentes.md, 6.8), a cada 60 s com X402_ENABLED:
//  1. ordens `created` vencidas -> `expired`;
//  2. `settling` parado: procura o pagamento na cadeia (memo = id da ordem). Achou -> `paid` e emite; não achou -> a transação do
//     agente já venceu (o blockhash dura ~1 min), então não pagou: `created` (se ainda vale) ou `expired`;
//  3. `paid`/`minting` parado: retoma pela transação gravada, refaz se nunca foi enviada, ou reembolsa;
//  4. `refunding`: repete o reembolso.
// A reconciliação completa (pagamentos SEM ordem) fica para a fase 4.

/** Quanto tempo `settling` espera antes de a cadeia decidir: bem além da vida da transação de pagamento do agente. */
const SETTLING_DECIDE_SECS = 240;
/** Quantas assinaturas recentes da conta de USDC da custódia olhar ao procurar um pagamento. */
const SCAN_LIMIT = 40;

type ParsedIx = { program?: string; parsed?: unknown };

/**
 * Procura na conta de USDC da custódia a transferência da ordem: `transferChecked` do pagador para a custódia, no valor exato,
 * na mesma transação do memo com o id da ordem. Devolve a assinatura, ou `null` se não há.
 */
export async function findPaymentSignature(order: OrderRow): Promise<string | null> {
  const c = chain();
  const custody = c.custodyAddress;
  if (!custody || !order.payer) return null;
  const ata = await c.ata(custody);
  const since = Math.floor(order.createdAt.getTime() / 1000) - 60;
  const sigs = await c.rpc.getSignaturesForAddress(ata, { limit: SCAN_LIMIT, commitment: "confirmed" }).send();
  for (const s of sigs) {
    if (s.err || (s.blockTime != null && Number(s.blockTime) < since)) continue;
    const tx = await c.rpc
      .getTransaction(s.signature as Signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
      .send();
    const ixs = ((tx?.transaction.message.instructions ?? []) as unknown as ParsedIx[]);
    const memo = ixs.find((i) => i.program === "spl-memo")?.parsed;
    if (memo !== order.id) continue;
    const transfer = ixs.find((i) => {
      const p = i.parsed as { type?: string; info?: { destination?: string } } | undefined;
      return p?.type === "transferChecked" && p.info?.destination === ata;
    })?.parsed as { info: { authority?: string; tokenAmount?: { amount?: string } } } | undefined;
    if (!transfer) continue;
    if (transfer.info.authority === order.payer && transfer.info.tokenAmount?.amount === order.price.toString()) return s.signature;
  }
  return null;
}

async function resolveSettling(row: OrderRow): Promise<number> {
  const signature = await findPaymentSignature(row);
  if (signature) {
    const paid = await move(row.id, "settling", "paid", { paySignature: signature });
    if (!paid) return 0;
    await fulfilOrder(row.id);
    return 1;
  }
  // Sem pagamento na cadeia e a transação do agente já venceu: não pagou.
  const back = await move(row.id, "settling", orderExpired(row) ? "expired" : "created");
  return back ? 1 : 0;
}

async function resolveStalled(row: OrderRow): Promise<number> {
  if (row.status === "paid") {
    await fulfilOrder(row.id);
    return 1;
  }
  if (row.mintSignature && row.mintWire) {
    await resumeMint(row);
    return 1;
  }
  // Emissão nunca assinada/enviada: nada pode ter entrado, então tentar de novo é seguro; passado o prazo, devolve o dinheiro.
  const paidAgeSecs = (Date.now() - row.createdAt.getTime()) / 1000;
  const decision = decideStalledMint({ outcome: "unsent", ownedByPayer: false, paidAgeSecs });
  if (decision === "retry") await attemptMint(row);
  else await refundOrder(row.id, "a emissão não pôde ser concluída a tempo");
  return 1;
}

/** Uma rodada. Devolve quantas ordens avançaram. */
export async function reconcileX402(): Promise<number> {
  if (!env.X402_ENABLED || !chain().custodyAddress) return 0;
  let n = await expireStale();

  for (const row of await ordersIn(["settling"], SETTLING_DECIDE_SECS, 10)) {
    try {
      n += await resolveSettling(row);
    } catch (e) {
      console.error(`[x402] reconciliação do pagamento ${row.id}:`, (e as Error).message);
    }
  }

  for (const row of await ordersIn(["paid", "minting"], STALE_SECS, 10)) {
    try {
      // Reserva atômica da retomada: outra instância não processa a mesma ordem junto.
      const leased = await lease(row.id, row.status as "paid" | "minting", STALE_SECS);
      if (leased) n += await resolveStalled(leased);
    } catch (e) {
      console.error(`[x402] retomada da emissão ${row.id}:`, (e as Error).message);
    }
  }

  for (const row of await ordersIn(["refunding"], 60, 10)) {
    try {
      const leased = await lease(row.id, "refunding", 60);
      if (leased && (await sendRefund(leased)).status === "refunded") n++;
    } catch (e) {
      console.error(`[x402] reembolso ${row.id}:`, (e as Error).message);
    }
  }
  return n;
}

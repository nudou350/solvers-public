import { eq } from "drizzle-orm";
import { parseEvents, type SolversEvent, type Signature } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import {
  agentIdByAddress,
  recordChainTx,
  syncAgent,
  syncCredits,
  syncEscrow,
  syncLicense,
  syncReputation,
  syncReview,
} from "./sync.js";

type Listener = (ev: SolversEvent, signature: string) => void | Promise<void>;
const listeners: Listener[] = [];

/** Permite que outros módulos (notificações, verificador) reajam a eventos indexados. */
export function onChainEvent(fn: Listener) {
  listeners.push(fn);
}

/**
 * Processa os eventos de uma transação do programa. Idempotente por (assinatura, índice):
 * webhook, polling e a própria API podem entregar a mesma transação sem duplicar nada.
 */
export async function processTransaction(
  signature: string,
  logs: readonly string[],
  opts: { failed?: boolean; blockTime?: number | null } = {},
): Promise<SolversEvent[]> {
  // Transação que falhou ainda pode ter logs "Program data" emitidos antes do erro.
  if (opts.failed) return [];
  const events = parseEvents(logs, chain().programId);
  const handled: SolversEvent[] = [];
  for (const [idx, ev] of events.entries()) {
    const inserted = await db
      .insert(schema.processedEvents)
      .values({ signature, idx, name: ev.name })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) continue;
    try {
      await handle(ev, signature, opts.blockTime ?? null);
      handled.push(ev);
    } catch (e) {
      // Desfaz a marca para o polling tentar de novo.
      await db.delete(schema.processedEvents).where(eq(schema.processedEvents.signature, signature));
      throw e;
    }
    for (const l of listeners) {
      Promise.resolve(l(ev, signature)).catch((err) => console.error("[indexer] listener", err));
    }
  }
  return handled;
}

async function handle(ev: SolversEvent, signature: string, blockTime: number | null) {
  switch (ev.name) {
    case "AgentRegistered":
    case "AgentStatusChanged":
    case "AgentVersionUpdated":
    case "EvalUpdated":
    case "StakeSlashed":
    case "UsageRecorded":
      await syncAgent(ev.data.agent);
      return;
    case "LicensePurchased": {
      const agentId = await syncAgent(ev.data.agent);
      if (!agentId) return;
      await syncLicense(ev.data.asset, agentId, signature, blockTime);
      await syncReputation(ev.data.buyer);
      await recordChainTx(signature, "purchase", ev.data.buyer, agentId, ev.data.price);
      return;
    }
    case "CreditsBought": {
      const agentId = await syncAgent(ev.data.agent);
      if (!agentId) return;
      await syncCredits(ev.data.agent, ev.data.buyer, agentId);
      await syncReputation(ev.data.buyer);
      await recordChainTx(signature, "credits", ev.data.buyer, agentId);
      return;
    }
    case "CreditConsumed": {
      const agentId = await syncAgent(ev.data.agent);
      if (agentId) await syncCredits(ev.data.agent, ev.data.owner, agentId);
      return;
    }
    case "ReviewSubmitted": {
      const agentId = await syncAgent(ev.data.agent);
      if (!agentId) return;
      await syncReview(ev.data.agent, ev.data.author, agentId);
      await recordChainTx(signature, "review", ev.data.author, agentId);
      return;
    }
    case "EscrowCreated": {
      await syncEscrow(ev.data.escrow);
      await syncReputation(ev.data.buyer);
      await recordChainTx(signature, "escrow", ev.data.buyer, await agentIdByAddress(ev.data.agent), ev.data.total);
      return;
    }
    case "MilestoneUpdated":
    case "DisputeResolved": {
      await syncEscrow(ev.data.escrow);
      const [row] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, ev.data.escrow));
      if (row) {
        const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, row.agentId));
        if (agent?.onchainAddress) await syncAgent(agent.onchainAddress as never);
        await syncReputation(row.buyerWallet as never);
        await recordChainTx(signature, ev.name === "DisputeResolved" ? "dispute_resolved" : "milestone", row.buyerWallet, row.agentId);
      }
      return;
    }
  }
}

/** Processa uma assinatura buscando os logs no RPC (usado pela API logo após enviar). */
export async function processSignature(signature: string): Promise<SolversEvent[]> {
  for (let i = 0; i < 20; i++) {
    const tx = await chain().txLogs(signature as Signature);
    if (tx) return processTransaction(signature, tx.logs, { failed: tx.failed, blockTime: tx.blockTime });
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

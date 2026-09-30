import { eq, sql } from "drizzle-orm";
import { parseEventsDetailed, type Address, type SolversEvent, type Signature } from "@solvers/chain";
import * as gen from "@solvers/client";
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

/** Permite que outros módulos (notificações, verificador) reajam a eventos novos. */
export function onChainEvent(fn: Listener) {
  listeners.push(fn);
}

export class IndexerRetryableError extends Error {}

/**
 * Processa os eventos de uma transação do programa.
 *
 * Os handlers só releem contas on-chain e espelham no banco, então são idempotentes: rodam
 * primeiro, e só depois a marca (assinatura, índice) é gravada. Se o processo cair no meio,
 * a próxima tentativa refaz tudo. A marca serve apenas para disparar listeners uma única vez.
 */
export async function processTransaction(
  signature: string,
  logs: readonly string[],
  opts: { failed?: boolean; blockTime?: number | null; accounts?: readonly Address[] } = {},
): Promise<SolversEvent[]> {
  // Transação que falhou ainda pode ter logs "Program data" emitidos antes do erro.
  if (opts.failed) return [];
  const { events, truncated } = parseEventsDetailed(logs, chain().programId);
  if (truncated) {
    // Logs truncados: eventos podem faltar. Relê as contas do programa tocadas pela transação.
    await resyncAccounts(opts.accounts ?? (await chain().txLogs(signature as Signature))?.accounts ?? []);
  }
  for (const ev of events) await handle(ev, signature, opts.blockTime ?? null);

  const fresh: SolversEvent[] = [];
  for (const [idx, ev] of events.entries()) {
    const inserted = await db
      .insert(schema.processedEvents)
      .values({ signature, idx, name: ev.name })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) fresh.push(ev);
  }
  for (const ev of fresh) {
    for (const l of listeners) {
      Promise.resolve(l(ev, signature)).catch((err) => console.error("[indexer] listener", err));
    }
  }
  return events;
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
        if (agent?.onchainAddress) await syncAgent(agent.onchainAddress as Address);
        await syncReputation(row.buyerWallet as Address);
        await recordChainTx(signature, ev.name === "DisputeResolved" ? "dispute_resolved" : "milestone", row.buyerWallet, row.agentId);
      }
      return;
    }
  }
}

const DISCRIMINATORS: Array<[string, ArrayLike<number>]> = [
  ["agent", gen.AGENT_DISCRIMINATOR],
  ["escrow", gen.ESCROW_DISCRIMINATOR],
  ["credits", gen.CREDITS_DISCRIMINATOR],
  ["review", gen.REVIEW_DISCRIMINATOR],
  ["reputation", gen.USER_REPUTATION_DISCRIMINATOR],
];

/** Plano B para logs truncados: identifica cada conta do programa pelo discriminador e espelha. */
async function resyncAccounts(accounts: readonly Address[]) {
  const c = chain();
  for (const acc of new Set(accounts)) {
    const { value } = await c.rpc.getAccountInfo(acc, { encoding: "base64" }).send();
    if (!value || value.owner !== c.programId) continue;
    const data = Buffer.from(value.data[0], "base64");
    const kind = DISCRIMINATORS.find(([, d]) => Array.from(d).every((b, i) => data[i] === b))?.[0];
    if (kind === "agent") await syncAgent(acc);
    else if (kind === "escrow") await syncEscrow(acc);
    else if (kind === "reputation") {
      const r = gen.getUserReputationDecoder().decode(data);
      await syncReputation(r.wallet);
    } else if (kind === "credits") {
      const cr = gen.getCreditsDecoder().decode(data);
      const agentId = await agentIdByAddress(cr.agent);
      if (agentId) await syncCredits(cr.agent, cr.owner, agentId);
    } else if (kind === "review") {
      const rv = gen.getReviewDecoder().decode(data);
      const agentId = await agentIdByAddress(rv.agent);
      if (agentId) await syncReview(rv.agent, rv.author, agentId);
    }
  }
}

/** Processa uma assinatura buscando os logs no RPC. Lança erro se o RPC ainda não a enxerga. */
export async function processSignature(signature: string): Promise<SolversEvent[]> {
  for (let i = 0; i < 20; i++) {
    const tx = await chain().txLogs(signature as Signature);
    if (tx) {
      return processTransaction(signature, tx.logs, { failed: tx.failed, blockTime: tx.blockTime, accounts: tx.accounts });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new IndexerRetryableError(`transação ${signature} ainda não visível no RPC`);
}

/** Registra uma falha para nova tentativa (até 10) sem travar o cursor do polling. */
export async function recordFailure(signature: string, error: unknown) {
  const message = (error as Error)?.message ?? String(error);
  await db
    .insert(schema.indexerFailures)
    .values({ signature, lastError: message.slice(0, 1000) })
    .onConflictDoUpdate({
      target: schema.indexerFailures.signature,
      set: { attempts: sql`${schema.indexerFailures.attempts} + 1`, lastError: message.slice(0, 1000), updatedAt: new Date() },
    });
}

export async function retryFailures(maxAttempts = 10): Promise<number> {
  const rows = await db
    .select()
    .from(schema.indexerFailures)
    .where(sql`${schema.indexerFailures.attempts} < ${maxAttempts} and ${schema.indexerFailures.updatedAt} < now() - interval '20 seconds'`)
    .limit(20);
  let ok = 0;
  for (const r of rows) {
    try {
      await processSignature(r.signature);
      await db.delete(schema.indexerFailures).where(eq(schema.indexerFailures.signature, r.signature));
      ok++;
    } catch (e) {
      await recordFailure(r.signature, e);
    }
  }
  return ok;
}

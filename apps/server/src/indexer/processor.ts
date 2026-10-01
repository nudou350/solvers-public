import { and, asc, eq, lte, sql } from "drizzle-orm";
import { parseEventsDetailed, type Address, type SolversEvent, type Signature, type TxInfo } from "@solvers/chain";
import * as gen from "@solvers/client";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { effectiveFeeBps, splitFromDeltas, type Split } from "./amounts.js";
import { MILESTONE_STATUS, type MilestoneStatusName } from "./escrow-status.js";
import {
  INFRA_RETRY_SECS,
  IndexerRetryableError,
  MAX_ATTEMPTS,
  MAX_INFRA_AGE_DAYS,
  backoffSecs,
  escrowNotVisible,
  isFreshTx,
  isInfraError,
} from "./retry-policy.js";
import {
  agentIdByAddress,
  recordChainTx,
  syncAgent,
  syncCredits,
  syncEscrow,
  syncLicense,
  syncReputation,
  syncReview,
  type ChainTxExtra,
} from "./sync.js";

export { IndexerRetryableError };

type Listener = (ev: SolversEvent, signature: string) => void | Promise<void>;
const listeners: Listener[] = [];

/** Permite que outros módulos (notificações, verificador) reajam a eventos novos. */
export function onChainEvent(fn: Listener) {
  listeners.push(fn);
}

/** Dados da transação que está sendo indexada; os logs e saldos só são buscados no RPC quando preciso. */
type TxContext = {
  signature: string;
  blockTime: number | null;
  info: () => Promise<TxInfo | null>;
};

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
  opts: { failed?: boolean; blockTime?: number | null; accounts?: readonly Address[]; tx?: TxInfo } = {},
): Promise<SolversEvent[]> {
  // Transação que falhou ainda pode ter logs "Program data" emitidos antes do erro.
  if (opts.failed) return [];
  let cached: TxInfo | null | undefined = opts.tx;
  const ctx: TxContext = {
    signature,
    blockTime: opts.blockTime ?? opts.tx?.blockTime ?? null,
    info: async () => {
      if (cached === undefined) cached = await chain().txLogs(signature as Signature);
      return cached;
    },
  };
  const { events, truncated } = parseEventsDetailed(logs, chain().programId);
  if (truncated) {
    // Logs truncados: eventos podem faltar. Relê as contas do programa tocadas pela transação.
    await resyncAccounts(opts.accounts ?? (await ctx.info())?.accounts ?? []);
  }
  for (const ev of events) await handle(ev, ctx);

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

// ---------- Valores executados ----------

/** Taxa da plataforma e conta de token da tesouraria (em cache curto: muda só com update_config). */
let platformCache: { at: number; feeBps: number | null; treasury: string | null } | null = null;

/** ConfigUpdated: a taxa/tesouraria mudou; a próxima transação relê a config. */
export function invalidatePlatformConfig() {
  platformCache = null;
}

async function platformConfig(): Promise<{ feeBps: number | null; treasury: string | null }> {
  if (platformCache && platformCache.treasury && Date.now() - platformCache.at < 60_000) return platformCache;
  // Até 3 tentativas: sem a tesouraria não há valores executados, e o backfill só revisita o que ficou nulo.
  for (let i = 0; i < 3; i++) {
    try {
      const cfg = await chain().fetchConfig();
      platformCache = { at: Date.now(), feeBps: cfg.data.feeBps, treasury: cfg.data.treasury };
      return platformCache;
    } catch {
      if (i < 2) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  // Falhou: reaproveita o último valor conhecido (se houver) e tenta de novo já na próxima transação.
  platformCache = { at: 0, feeBps: platformCache?.feeBps ?? null, treasury: platformCache?.treasury ?? null };
  return platformCache;
}

type Financial = { amount: bigint | undefined; extra: ChainTxExtra };

/**
 * Valor bruto, taxa e parte do criador da transação, lidos dos saldos de token (o que de fato saiu do
 * pagador e chegou à tesouraria). Sem saldos, grava só o bruto de `fallbackGross` e a taxa configurada:
 * `fee`/`creator_amount` ficam nulos e o painel calcula com `fee_bps` (ver store/me.ts).
 * `refund`: o dinheiro voltou ao comprador, então nada foi para a plataforma nem para o criador.
 */
async function financial(
  ctx: TxContext,
  payerOwner: string,
  creatorWallet: string | null,
  fallbackGross: bigint | undefined,
  refund = false,
  /** Taxa congelada no escrow (programa v2): vale mais que a config atual. */
  frozenFeeBps: number | null = null,
): Promise<Financial> {
  const blockTime = await blockTimeOf(ctx);
  const cfg = await platformConfig();
  const info = await ctx.info();
  const split: Split | null = info ? splitFromDeltas(info.tokenDeltas, chain().usdcMint, payerOwner, cfg.treasury) : null;
  const configured = frozenFeeBps ?? cfg.feeBps;
  if (!split) return { amount: fallbackGross, extra: { blockTime, creatorWallet, feeBps: configured } };
  if (refund) return { amount: split.gross, extra: { blockTime, fee: 0n, creatorAmount: 0n, creatorWallet, feeBps: configured } };
  return {
    amount: split.gross,
    extra: { blockTime, fee: split.fee, creatorAmount: split.creatorAmount, creatorWallet, feeBps: effectiveFeeBps(split, configured) },
  };
}

async function blockTimeOf(ctx: TxContext): Promise<Date | null> {
  const t = ctx.blockTime ?? (await ctx.info())?.blockTime ?? null;
  return t != null ? new Date(t * 1000) : null;
}

/** Carteira do criador de um especialista (creators.wallet; agentes só do espelho guardam a própria carteira). */
async function creatorWalletOfAgent(agentId: string): Promise<string | null> {
  const [row] = await db
    .select({ creatorId: schema.agents.creatorId, wallet: schema.creators.wallet })
    .from(schema.agents)
    .leftJoin(schema.creators, eq(schema.creators.id, schema.agents.creatorId))
    .where(eq(schema.agents.id, agentId));
  return row ? (row.wallet ?? row.creatorId) : null;
}

async function milestoneAmount(escrowId: string, index: number): Promise<bigint | undefined> {
  const [m] = await db
    .select({ amount: schema.milestones.amount })
    .from(schema.milestones)
    .where(and(eq(schema.milestones.escrowId, escrowId), eq(schema.milestones.idx, index)));
  return m?.amount;
}

/** O agente on-chain ainda não está visível: não dá para espelhar, então tenta de novo (não descarta o evento). */
function agentMissing(agent: string): IndexerRetryableError {
  return new IndexerRetryableError(`especialista ${agent} ainda não visível no RPC`);
}

async function handle(ev: SolversEvent, ctx: TxContext) {
  const { signature } = ctx;
  switch (ev.name) {
    case "AgentRegistered":
    case "AgentStatusChanged":
    case "AgentVersionUpdated":
    case "EvalUpdated":
    case "StakeSlashed":
    case "StakeToppedUp": // top_up_stake: agents.stake é espelhado, relê a conta
    case "UsageRecorded":
    case "PricingUpdated": // update_pricing agora emite evento: o preço do espelho não fica mais defasado
      await syncAgent(ev.data.agent);
      return;
    case "ConfigUpdated":
    case "TreasuryUpdated": // set_treasury: a conta de USDC da tesouraria mudou; a próxima transação relê a config
      invalidatePlatformConfig();
      return;
    case "AdminTransferProposed":
    case "AdminTransferCancelled":
    case "AdminTransferred":
      // Rotação de admin: nada é espelhado (o admin só vive na Config on-chain). Entra em processed_events e nos listeners.
      return;
    case "EscrowClosed":
      // Idempotente; não apaga as etapas (o histórico e a entrega paga continuam consultáveis).
      await db.update(schema.escrows).set({ closed: true }).where(eq(schema.escrows.id, ev.data.escrow));
      return;
    case "LicensePurchased": {
      const agentId = await syncAgent(ev.data.agent);
      if (!agentId) throw agentMissing(ev.data.agent);
      await syncLicense(ev.data.asset, agentId, signature, ctx.blockTime);
      await syncReputation(ev.data.buyer);
      const fin = await financial(ctx, ev.data.buyer, await creatorWalletOfAgent(agentId), ev.data.price);
      await recordChainTx(signature, "purchase", ev.data.buyer, agentId, fin.amount, fin.extra);
      return;
    }
    case "CreditsBought": {
      const agentId = await syncAgent(ev.data.agent);
      if (!agentId) throw agentMissing(ev.data.agent);
      await syncCredits(ev.data.agent, ev.data.buyer, agentId);
      await syncReputation(ev.data.buyer);
      // O evento traz só a quantidade. O valor real vem dos saldos da transação; só sem eles usa
      // quantidade × preço por uso (o preço atual, que pode ter mudado desde a compra).
      const [agentRow] = await db.select({ pricePerUse: schema.agents.pricePerUse }).from(schema.agents).where(eq(schema.agents.id, agentId));
      const estimate = agentRow ? agentRow.pricePerUse * BigInt(ev.data.amount) : undefined;
      const fin = await financial(ctx, ev.data.buyer, await creatorWalletOfAgent(agentId), estimate);
      await recordChainTx(signature, "credits", ev.data.buyer, agentId, fin.amount, fin.extra);
      return;
    }
    case "CreditConsumed": {
      const agentId = await syncAgent(ev.data.agent);
      if (agentId) await syncCredits(ev.data.agent, ev.data.owner, agentId);
      return;
    }
    case "ReviewSubmitted": {
      const agentId = await syncAgent(ev.data.agent);
      if (!agentId) throw agentMissing(ev.data.agent);
      await syncReview(ev.data.agent, ev.data.author, agentId);
      await recordChainTx(signature, "review", ev.data.author, agentId, undefined, { blockTime: await blockTimeOf(ctx) });
      return;
    }
    case "EscrowCreated": {
      // Conta recém-criada não pode estar ausente: se o RPC ainda não a mostra, tenta de novo em vez de seguir sem
      // espelhar o escrow (syncEscrow devolve false sem erro). Em transação antiga a ausência pode ser um fechamento real.
      const fresh = isFreshTx(await blockTimeOf(ctx));
      if (!(await syncEscrow(ev.data.escrow, undefined, { leaveIfMissing: fresh })) && fresh) throw escrowNotVisible(ev.data.escrow);
      await syncReputation(ev.data.buyer);
      await recordChainTx(signature, "escrow", ev.data.buyer, await agentIdByAddress(ev.data.agent), ev.data.total, {
        blockTime: await blockTimeOf(ctx),
      });
      return;
    }
    case "MilestoneUpdated":
    case "DisputeResolved": {
      const isDispute = ev.name === "DisputeResolved";
      const status: MilestoneStatusName = isDispute ? (ev.data.refunded ? "refunded" : "approved") : (MILESTONE_STATUS[ev.data.status] ?? "pending");
      // Se o escrow já foi fechado, o próprio evento diz como a etapa terminou (ver syncEscrow).
      await syncEscrow(ev.data.escrow, { index: ev.data.index, status });
      const [row] = await db.select().from(schema.escrows).where(eq(schema.escrows.id, ev.data.escrow));
      if (!row) return;
      const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, row.agentId));
      if (agent?.onchainAddress) await syncAgent(agent.onchainAddress as Address);
      await syncReputation(row.buyerWallet as Address);
      // Só liberação (pago ao criador) e reembolso movimentam dinheiro; etapa aprovada nos testes ou contestada não.
      const moved = isDispute || status === "approved" || status === "refunded";
      const fin = moved
        ? await financial(ctx, ev.data.escrow, row.creatorWallet, await milestoneAmount(row.id, ev.data.index), status === "refunded", row.feeBps)
        : { amount: undefined, extra: { blockTime: await blockTimeOf(ctx) } as ChainTxExtra };
      await recordChainTx(signature, isDispute ? "dispute_resolved" : "milestone", row.buyerWallet, row.agentId, fin.amount, fin.extra);
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
      return processTransaction(signature, tx.logs, { failed: tx.failed, blockTime: tx.blockTime, accounts: tx.accounts, tx });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new IndexerRetryableError(`transação ${signature} ainda não visível no RPC`);
}

// ---------- Falhas e novas tentativas ----------

/**
 * Registra uma falha para nova tentativa sem travar o cursor do polling. Backoff exponencial
 * (30 s até 6 h). Falha de infraestrutura (RPC fora, limite de requisições) não gasta tentativas:
 * só repete a cada minuto. Depois de MAX_ATTEMPTS falhas reais (ou de MAX_INFRA_AGE_DAYS dias de
 * infraestrutura) a assinatura vira "dead": avisa no log e espera reprocesso manual (cli:reindex).
 */
export async function recordFailure(signature: string, error: unknown) {
  const message = ((error as Error)?.message ?? String(error)).slice(0, 1000);
  const f = schema.indexerFailures;
  const infra = isInfraError(error);
  const raw = (n: number) => sql.raw(String(n));
  const [row] = await db
    .insert(f)
    .values({
      signature,
      attempts: infra ? 0 : 1,
      lastError: message,
      nextAttemptAt: new Date(Date.now() + (infra ? INFRA_RETRY_SECS : backoffSecs(1)) * 1000),
    })
    .onConflictDoUpdate({
      target: f.signature,
      set: infra
        ? {
            lastError: message,
            nextAttemptAt: sql`now() + make_interval(secs => ${raw(INFRA_RETRY_SECS)})`,
            status: sql`case when ${f.createdAt} < now() - make_interval(days => ${raw(MAX_INFRA_AGE_DAYS)}) then 'dead' else ${f.status} end`,
            updatedAt: new Date(),
          }
        : {
            attempts: sql`${f.attempts} + 1`,
            lastError: message,
            nextAttemptAt: sql`now() + make_interval(secs => least(${raw(backoffSecs(99))}, ${raw(backoffSecs(1))} * power(2, ${f.attempts})))`,
            status: sql`case when ${f.attempts} + 1 >= ${raw(MAX_ATTEMPTS)} then 'dead' else 'pending' end`,
            updatedAt: new Date(),
          },
    })
    .returning({ status: f.status, attempts: f.attempts });
  if (row?.status === "dead") {
    console.error(`[indexer] DESISTIU de ${signature} (${row.attempts} falhas): ${message}. Reprocesse com: pnpm --filter @solvers/server cli:reindex --dead`);
  }
}

/** A assinatura foi indexada com sucesso: apaga a pendência, se havia. */
export async function clearFailure(signature: string) {
  await db.delete(schema.indexerFailures).where(eq(schema.indexerFailures.signature, signature));
}

/** Tenta de novo as falhas cujo horário de nova tentativa já chegou. Devolve quantas foram resolvidas. */
export async function retryFailures(limit = 20): Promise<number> {
  const f = schema.indexerFailures;
  const rows = await db
    .select()
    .from(f)
    .where(and(eq(f.status, "pending"), lte(f.nextAttemptAt, sql`now()`)))
    .orderBy(asc(f.nextAttemptAt))
    .limit(limit);
  let ok = 0;
  let infraStreak = 0;
  for (const r of rows) {
    try {
      await processSignature(r.signature);
      await clearFailure(r.signature);
      ok++;
      infraStreak = 0;
    } catch (e) {
      await recordFailure(r.signature, e);
      // RPC fora do ar: não adianta martelar as outras; a próxima rodada tenta.
      if (isInfraError(e) && ++infraStreak >= 3) break;
    }
  }
  return ok;
}

/** Devolve as assinaturas "dead" para a fila (tentativas zeradas). Devolve quantas voltaram. */
export async function reviveDeadFailures(): Promise<number> {
  const f = schema.indexerFailures;
  const rows = await db
    .update(f)
    .set({ status: "pending", attempts: 0, nextAttemptAt: sql`now()`, updatedAt: new Date() })
    .where(eq(f.status, "dead"))
    .returning({ signature: f.signature });
  return rows.length;
}

/**
 * Reprocessa assinaturas na hora (manual ou reconciliação). Idempotente: o espelho é reconstruído a
 * partir do estado on-chain e chain_txs é completado (horário do bloco e valores executados).
 */
export async function reprocessSignatures(signatures: readonly string[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const sig of signatures) {
    try {
      await processSignature(sig);
      await clearFailure(sig);
      ok++;
    } catch (e) {
      await recordFailure(sig, e);
      failed++;
    }
  }
  return { ok, failed };
}

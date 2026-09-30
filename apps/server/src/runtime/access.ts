import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { address } from "@solvers/chain";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { refreshLicenseOwner, syncLicense } from "../indexer/sync.js";
import type { SolverPackage } from "./packages.js";
import { trialLimits, type TrialLimits, type TrialUsage } from "./trial.js";
import { escrowGivesAccess, OPEN_ESCROW_STATUSES, type PaidAccess } from "./access-rules.js";

export type { PaidAccess } from "./access-rules.js";

export type Access =
  | ({ ok: true } & PaidAccess)
  | { ok: true; kind: "trial"; trial: TrialLimits; used: number; remaining: number; usage: TrialUsage }
  | { ok: false; reason: "no_trial" | "trial_exhausted"; trial: TrialLimits | null };

type AgentRow = typeof schema.agents.$inferSelect;

/** Licença permanente válida? Confere o dono atual on-chain (a licença pode ter sido revendida). */
async function licenseOf(wallet: string, agent: AgentRow): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.licenses)
    .where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, agent.id)));
  for (const r of rows) {
    // Se o RPC falhar, vale o dono registrado no banco (nunca "assume" a carteira que pediu).
    const owner = await refreshLicenseOwner(r.id).catch(() => r.ownerWallet);
    if (owner === wallet) return r.id;
  }
  // Fallback on-chain: comprou e o indexador ainda não gravou (INSTRUCTIONS.md 5.11).
  if (agent.collectionAddress) {
    const found = await Promise.race([
      chain().findLicenses(address(wallet), address(agent.collectionAddress)),
      new Promise<never[]>((r) => setTimeout(() => r([]), 3000)),
    ]).catch(() => []);
    for (const asset of found) {
      await syncLicense(asset, agent.id);
      return asset;
    }
  }
  return null;
}

/** Tarefa com garantia aberta desta carteira para o solver (dá acesso sem limites enquanto durar). */
async function openEscrowOf(wallet: string, agentId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.escrows.id })
    .from(schema.escrows)
    .where(
      and(
        eq(schema.escrows.buyerWallet, wallet),
        eq(schema.escrows.agentId, agentId),
        eq(schema.escrows.closed, false),
        inArray(schema.escrows.status, [...OPEN_ESCROW_STATUSES]),
      ),
    )
    // Mais de uma aberta: a mais recente (resultado estável, não depende da ordem do banco).
    .orderBy(desc(schema.escrows.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function escrowIsOpen(escrowId: string): Promise<boolean> {
  const [row] = await db.select({ status: schema.escrows.status, closed: schema.escrows.closed }).from(schema.escrows).where(eq(schema.escrows.id, escrowId));
  return !!row && escrowGivesAccess(row);
}

/** Acesso pago sem consumir nada: licença vitalícia > tarefa com garantia aberta. */
export async function paidAccess(wallet: string, agent: AgentRow): Promise<PaidAccess | null> {
  const licenseId = await licenseOf(wallet, agent);
  if (licenseId) return { kind: "license", licenseId };
  const escrowId = await openEscrowOf(wallet, agent.id);
  return escrowId ? { kind: "guarantee", escrowId } : null;
}

export async function paidAccessById(wallet: string, agentId: string): Promise<PaidAccess | null> {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  return agent ? paidAccess(wallet, agent) : null;
}

/**
 * A sessão paga continua valendo? Licença revendida ou garantia encerrada: não (a sessão é
 * descartada e a ativação segue o fluxo normal). Sessões de teste sempre valem aqui.
 */
export async function sessionGrantValid(s: typeof schema.sessions.$inferSelect): Promise<boolean> {
  if (s.access === "license") {
    if (!s.licenseId) return false;
    const [lic] = await db.select({ owner: schema.licenses.ownerWallet }).from(schema.licenses).where(eq(schema.licenses.id, s.licenseId));
    const owner = await refreshLicenseOwner(s.licenseId).catch(() => lic?.owner ?? null);
    return owner === s.wallet;
  }
  if (s.access === "guarantee") {
    const escrowId = (s.context as { escrowId?: unknown }).escrowId;
    return typeof escrowId === "string" && (await escrowIsOpen(escrowId));
  }
  return s.access === "trial";
}

/**
 * Decide como a carteira acessa o solver nesta ativação: licença vitalícia > tarefa com garantia
 * aberta > teste grátis (se o especialista tiver; usos por carteira contados off-chain).
 */
export async function resolveAccess(wallet: string, agent: AgentRow, pkg: SolverPackage, opts: { consume: boolean }): Promise<Access> {
  const paid = await paidAccess(wallet, agent);
  if (paid) return { ok: true, ...paid };

  const trial = trialLimits(pkg.manifest);
  if (!trial) return { ok: false, reason: "no_trial", trial: null };
  const [row] = await db
    .select()
    .from(schema.trials)
    .where(and(eq(schema.trials.agentId, agent.id), eq(schema.trials.wallet, wallet)));
  const used = row?.used ?? 0;
  if (used >= trial.uses) return { ok: false, reason: "trial_exhausted", trial };
  if (!opts.consume) return { ok: true, kind: "trial", trial, used, remaining: trial.uses - used, usage: usageOf(row) };
  // Incremento atômico com teto, para duas ativações simultâneas não passarem do limite.
  const [updated] = await db
    .insert(schema.trials)
    .values({ agentId: agent.id, wallet, used: 1 })
    .onConflictDoUpdate({
      target: [schema.trials.agentId, schema.trials.wallet],
      set: { used: sql`${schema.trials.used} + 1`, updatedAt: new Date() },
      setWhere: sql`${schema.trials.used} < ${trial.uses}`,
    })
    .returning();
  if (!updated) return { ok: false, reason: "trial_exhausted", trial };
  return { ok: true, kind: "trial", trial, used: updated.used, remaining: trial.uses - updated.used, usage: usageOf(updated) };
}

function usageOf(row: typeof schema.trials.$inferSelect | undefined): TrialUsage {
  return { searchesUsed: row?.searchesUsed ?? 0, toolRuns: row?.toolRuns ?? {} };
}

/** O que a carteira já gastou do teste deste solver. */
export async function trialUsage(wallet: string, agentId: string): Promise<{ used: number; usage: TrialUsage }> {
  const [row] = await db
    .select()
    .from(schema.trials)
    .where(and(eq(schema.trials.agentId, agentId), eq(schema.trials.wallet, wallet)));
  return { used: row?.used ?? 0, usage: usageOf(row) };
}

const trialKey = (wallet: string, agentId: string) => and(eq(schema.trials.agentId, agentId), eq(schema.trials.wallet, wallet));

/** Consome 1 consulta à base do teste (atômico com teto). false: acabaram as consultas. */
export async function consumeTrialSearch(wallet: string, agentId: string, limit: number): Promise<boolean> {
  const rows = await db
    .update(schema.trials)
    .set({ searchesUsed: sql`${schema.trials.searchesUsed} + 1`, updatedAt: new Date() })
    .where(and(trialKey(wallet, agentId), sql`${schema.trials.searchesUsed} < ${limit}`))
    .returning({ n: schema.trials.searchesUsed });
  return rows.length > 0;
}

const runsOf = (tool: string) => sql`coalesce((${schema.trials.toolRuns} ->> ${tool})::int, 0)`;

/** Consome 1 execução da ferramenta no teste (atômico com teto). false: limite atingido. */
export async function consumeTrialTool(wallet: string, agentId: string, tool: string, limit: number): Promise<boolean> {
  const rows = await db
    .update(schema.trials)
    .set({
      toolRuns: sql`jsonb_set(${schema.trials.toolRuns}, array[${tool}]::text[], to_jsonb(${runsOf(tool)} + 1))`,
      updatedAt: new Date(),
    })
    .where(and(trialKey(wallet, agentId), sql`${runsOf(tool)} < ${limit}`))
    .returning({ agentId: schema.trials.agentId });
  return rows.length > 0;
}

/** Devolve a execução quando a ferramenta recusou a entrada (a IA corrige e tenta de novo sem perder o uso). */
export async function refundTrialTool(wallet: string, agentId: string, tool: string): Promise<void> {
  await db
    .update(schema.trials)
    .set({ toolRuns: sql`jsonb_set(${schema.trials.toolRuns}, array[${tool}]::text[], to_jsonb(${runsOf(tool)} - 1))` })
    .where(and(trialKey(wallet, agentId), sql`${runsOf(tool)} > 0`));
}

/** Solvers com licença da carteira, para list_my_solvers. */
export async function ownedAgents(wallet: string): Promise<Set<string>> {
  const lic = await db
    .select({ agentId: schema.licenses.agentId })
    .from(schema.licenses)
    .where(eq(schema.licenses.ownerWallet, wallet));
  return new Set(lic.map((l) => l.agentId));
}

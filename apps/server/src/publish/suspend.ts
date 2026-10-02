import { and, desc, eq, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { isPlatformAgentRow } from "../runtime/platform-agents.js";
import { publishChain, type PublishChain } from "./chain-port.js";

// Kill switch do admin (PACKAGE_SPEC.md 15.4): `cli:suspend <slug>` e `cli:suspend <slug> --resume`.
//  1. `agents.platform_status` (coluna que o indexador NUNCA escreve): corta já sessões abertas, vitrine e venda (o
//     `getSession` e o resto conferem a coluna a cada chamada).
//  2. `suspend_agent` on-chain com a carteira do admin (fecha DEF-22): sem isso a compra direta pela cadeia
//     (`purchase_license`, que só exige Active) continuaria possível.
//  3. Trilha: linha `suspend`/`resume` em `package_reviews` (somente-insert) e a submissão `published` <-> `suspended`.
// A ordem é fail-safe: o banco (efeito imediato) primeiro ao suspender; a cadeia primeiro ao reativar. Rodar de novo
// depois de uma falha na cadeia completa o que faltou sem duplicar a trilha.

export class SuspendError extends Error {}

type AgentRow = typeof schema.agents.$inferSelect;

export type SuspendResult = {
  agentId: string;
  slug: string;
  action: "suspend" | "resume";
  /** O banco mudou (platform_status). */
  platformChanged: boolean;
  /** Assinatura do suspend_agent/approve_agent on-chain (null: nada a fazer na cadeia, ou Solver só do banco). */
  chainTx: string | null;
  submissionId: string | null;
};

export async function findAgentByRef(ref: string): Promise<AgentRow> {
  const [row] = await db
    .select()
    .from(schema.agents)
    .where(or(eq(schema.agents.slug, ref), eq(schema.agents.id, ref)));
  if (!row) throw new SuspendError(`Solver "${ref}" não encontrado (use o slug ou o id)`);
  return row;
}

/** Submissão que reflete o Solver no ar: a `published` (ao suspender) ou a `suspended` (ao reativar) mais recente. */
async function currentSubmission(agentId: string, status: "published" | "suspended") {
  const t = schema.packageSubmissions;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.agentId, agentId), eq(t.status, status)))
    .orderBy(desc(t.createdAt))
    .limit(1);
  return row ?? null;
}

export async function suspendSolver(
  ref: string,
  opts: { resume?: boolean; reason?: string; port?: PublishChain } = {},
): Promise<SuspendResult> {
  const port = opts.port ?? publishChain();
  const agent = await findAgentByRef(ref);
  const resume = opts.resume === true;
  const reason = opts.reason?.trim() || (resume ? "Reativado pelo admin" : "Suspenso pelo admin");
  const actor = (await port.adminAddress()) ?? "cli";
  // Solver da plataforma (sem conta on-chain) só tem o lado do banco.
  const hasChain = !isPlatformAgentRow(agent);
  const result: SuspendResult = { agentId: agent.id, slug: agent.slug, action: resume ? "resume" : "suspend", platformChanged: false, chainTx: null, submissionId: null };

  if (resume) {
    // Cadeia primeiro: o Solver só volta a vender com a conta Active e a coluna da plataforma ativa.
    if (hasChain) result.chainTx = await onchain(port, agent.id, "resume");
    await markPlatform(agent, "active", result, { from: "suspended", to: "published", action: "resume", reason, actor });
    return result;
  }
  // Banco primeiro: o efeito é imediato (sessões e venda caem já), mesmo que a cadeia falhe.
  await markPlatform(agent, "suspended", result, { from: "published", to: "suspended", action: "suspend", reason, actor });
  if (hasChain) {
    try {
      result.chainTx = await onchain(port, agent.id, "suspend");
    } catch (e) {
      throw new SuspendError(
        `suspenso na plataforma (sessões e venda já caíram), MAS o suspend_agent on-chain falhou: ${(e as Error).message}. Rode de novo: a compra direta pela cadeia continua possível até a conta ser suspensa.`,
      );
    }
  }
  return result;
}

/** suspend_agent / approve_agent (reativação) só quando a conta não está já no estado pedido; indexa a assinatura. */
async function onchain(port: PublishChain, agentId: string, action: "suspend" | "resume"): Promise<string | null> {
  const state = await port.fetchAgentState(agentId);
  if (!state.exists) return null;
  const wanted = action === "suspend" ? state.status !== "suspended" : state.status === "suspended";
  if (!wanted) return null;
  const sig = action === "suspend" ? await port.suspendAgent(agentId) : await port.approveAgent(agentId);
  await port.indexSignature(sig).catch(() => undefined);
  return sig;
}

async function markPlatform(
  agent: AgentRow,
  to: "active" | "suspended",
  result: SuspendResult,
  audit: { from: "published" | "suspended"; to: "published" | "suspended"; action: "suspend" | "resume"; reason: string; actor: string },
): Promise<void> {
  const changed = agent.platformStatus !== to;
  result.platformChanged = changed;
  if (!changed) return; // já estava assim (nova tentativa depois de falha na cadeia): não duplica a trilha
  const sub = await currentSubmission(agent.id, audit.from);
  result.submissionId = sub?.id ?? null;
  await db.transaction(async (tx) => {
    await tx.update(schema.agents).set({ platformStatus: to, updatedAt: new Date() }).where(eq(schema.agents.id, agent.id));
    if (sub) {
      await tx
        .update(schema.packageSubmissions)
        .set({ status: audit.to, updatedAt: new Date() })
        .where(and(eq(schema.packageSubmissions.id, sub.id), eq(schema.packageSubmissions.status, audit.from)));
    }
    await tx.insert(schema.packageReviews).values({
      // Solver sem submissão (pacote da plataforma publicado pelo CLI): a trilha fica sob o id do agente.
      submissionId: sub?.id ?? `agent:${agent.id}`,
      reviewerWallet: audit.actor,
      action: audit.action,
      notes: audit.reason,
      versionHash: agent.versionHash,
    });
  });
}

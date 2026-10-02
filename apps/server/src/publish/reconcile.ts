import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { SolversEvent } from "@solvers/chain";
import { db, schema } from "../db/index.js";
import { onChainEvent } from "../indexer/processor.js";
import { publishChain } from "./chain-port.js";
import { finalizePublication, type FinalizeDeps, type FinalizeResult } from "./finalize.js";

// Liga o que a cadeia diz à submissão (PACKAGE_SPEC.md 15.3). Duas entradas, mesma lógica idempotente:
//  - o evento do indexador (`AgentRegistered`, `AgentVersionUpdated`, `PricingUpdated`, `AgentStatusChanged`): vale para
//    qualquer caminho (o /tx/submit indexa na hora, o webhook e o polling também) e é o que finaliza quando o admin aprova;
//  - a confirmação explícita do site (POST /tx/publication/confirm), que responde já com o estado novo.
// Em ambos: grava a assinatura (`register_tx`/`approve_tx`) e deixa a finalização decidir o que falta lendo a cadeia.

/** Submissões esperando a cadeia (o criador assinar ou o admin aprovar): é aqui que um evento pode destravar. */
const WAITING = ["awaiting_creator_signature", "awaiting_onchain_approval"] as const;

export type ChainTouch = {
  /** Assinatura da transação que mexeu na cadeia. */
  signature?: string;
  /** O que a transação foi. `status_active` é o approve_agent do admin. */
  kind?: "registered" | "version" | "pricing" | "status_active";
};

export type ReconcileResult = { submissionId: string | null; result: FinalizeResult | null };

export async function reconcileAgent(agentId: string, touch: ChainTouch = {}, deps?: Partial<FinalizeDeps>): Promise<ReconcileResult> {
  const [sub] = await db
    .select()
    .from(schema.packageSubmissions)
    .where(and(eq(schema.packageSubmissions.agentId, agentId), inArray(schema.packageSubmissions.status, [...WAITING])))
    .orderBy(desc(schema.packageSubmissions.createdAt))
    .limit(1);
  if (!sub) return { submissionId: null, result: null };
  // O approve_agent só vale como `approve_tx` se a conta está mesmo Active (um evento adiantado, com o RPC atrasado, não conta).
  if (touch.kind === "status_active" && touch.signature) {
    const state = await (deps?.port ?? publishChain()).fetchAgentState(agentId).catch(() => null);
    if (!state?.exists || state.status !== "active") touch = { ...touch, signature: undefined };
  }
  await recordSignature(sub.id, sub.approved?.version ?? null, sub.agentId, touch);
  return { submissionId: sub.id, result: await finalizePublication(sub.id, { deps }) };
}

/** register_tx: a primeira transação do criador (registro ou versão); approve_tx: o approve_agent do admin. Só preenche o que está vazio. */
async function recordSignature(submissionId: string, version: string | null, agentId: string, touch: ChainTouch): Promise<void> {
  if (!touch.signature) return;
  const t = schema.packageSubmissions;
  if (touch.kind === "status_active") {
    await db.update(t).set({ approveTx: touch.signature, updatedAt: new Date() }).where(and(eq(t.id, submissionId), isNull(t.approveTx)));
    if (version) {
      const v = schema.agentPublishedVersions;
      await db.update(v).set({ approveTx: touch.signature }).where(and(eq(v.agentId, agentId), eq(v.version, version), isNull(v.approveTx)));
    }
    return;
  }
  if (touch.kind === "registered" || touch.kind === "version") {
    // O registro/versão é "a" transação da publicação: vale a mais recente dela (a do preço não a sobrescreve).
    await db.update(t).set({ registerTx: touch.signature, updatedAt: new Date() }).where(eq(t.id, submissionId));
    return;
  }
  await db.update(t).set({ registerTx: touch.signature, updatedAt: new Date() }).where(and(eq(t.id, submissionId), isNull(t.registerTx)));
}

const TOUCH_KIND: Partial<Record<SolversEvent["name"], ChainTouch["kind"]>> = {
  AgentRegistered: "registered",
  AgentVersionUpdated: "version",
  PricingUpdated: "pricing",
  AgentStatusChanged: "status_active",
};

/** Reação a um evento do indexador (exportada para os testes simularem eventos). */
export async function onPublishEvent(ev: SolversEvent, signature: string, deps?: Partial<FinalizeDeps>): Promise<ReconcileResult | null> {
  const kind = TOUCH_KIND[ev.name];
  if (!kind) return null;
  // Mudança de status que não é "virou Active" (suspender, aposentar) não destrava nada.
  if (ev.name === "AgentStatusChanged" && ev.data.status !== 1) return null;
  const addr = (ev.data as { agent: string }).agent;
  const [row] = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.onchainAddress, addr)).limit(1);
  if (!row) return null;
  return reconcileAgent(row.id, { signature, kind }, deps);
}

let registered = false;

/** Escuta o indexador. Idempotente (as rotas importam este módulo mais de uma vez em testes). */
export function registerPublishListeners(): void {
  if (registered) return;
  registered = true;
  onChainEvent(async (ev, signature) => {
    await onPublishEvent(ev, signature);
  });
}

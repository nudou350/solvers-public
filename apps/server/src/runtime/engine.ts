import { and, desc, eq, gt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "../db/index.js";
import { forbidden, notFound } from "../lib/http.js";
import { randomId, sha256Hex } from "../lib/crypto.js";
import type { SolverPackage } from "./packages.js";
import { escrowIsOpen, paidAccessById, sessionGrantValid, type PaidAccess, type PlatformAccess } from "./access.js";
import { assertAgentCanServe, servePolicy, type AccessKind } from "./availability.js";
import { licenseRecheckDue, withSummary } from "./session-rules.js";
import { declaredTemplates, templatesOverview } from "./templates.js";

// Motor de etapas (INSTRUCTIONS.md 5.4): sessão por ativação, uma etapa por vez, gates,
// e marca d'água simples por carteira.

export type Session = typeof schema.sessions.$inferSelect;

/** Última validação on-chain bem-sucedida da licença por sessão (licença:carteira), em ms. */
const licenseChecked = new Map<string, number>();

/** Teste grátis: sessão curta e com teto de chamadas (evita baixar a base inteira de graça). */
const TRIAL_TTL_MS = 2 * 3600_000;
const PAID_TTL_MS = 24 * 3600_000;
export const TRIAL_MAX_CALLS = 60;

/** Acesso da sessão: teste grátis, pago (licença / tarefa com garantia, cujo escrowId fica no context) ou Solver da plataforma (gratuito). */
export type SessionGrant = { kind: "trial" } | PaidAccess | PlatformAccess;

export async function createSession(wallet: string, pkg: SolverPackage, grant: SessionGrant): Promise<Session> {
  const ttl = grant.kind === "trial" ? TRIAL_TTL_MS : PAID_TTL_MS;
  const [s] = await db
    .insert(schema.sessions)
    .values({
      id: `ses_${randomId(12)}`,
      wallet,
      agentId: pkg.manifest.id,
      version: pkg.manifest.version,
      stepIndex: 0,
      access: grant.kind,
      licenseId: grant.kind === "license" ? grant.licenseId : null,
      context: grant.kind === "guarantee" ? { summaries: [], escrowId: grant.escrowId } : { summaries: [] },
      expiresAt: new Date(Date.now() + ttl),
    })
    .returning();
  return s!;
}

/** Sessão ainda aberta da mesma carteira e solver: reaproveitada sem cobrar outro uso. */
export async function findOpenSession(wallet: string, agentId: string, version: string, totalSteps: number): Promise<Session | null> {
  const [s] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.wallet, wallet),
        eq(schema.sessions.agentId, agentId),
        eq(schema.sessions.version, version),
        gt(schema.sessions.expiresAt, new Date()),
        sql`${schema.sessions.stepIndex} <= ${totalSteps}`,
      ),
    )
    .orderBy(desc(schema.sessions.createdAt))
    .limit(1);
  return s ?? null;
}

/**
 * Sessão de teste de quem passou a ter acesso pago (comprou a licença ou abriu uma garantia):
 * vira sessão paga, sem limites e com o TTL pago, mantendo a etapa em que o usuário parou.
 */
export async function promoteSession(session: Session, paid: PaidAccess): Promise<Session> {
  const context = { ...(session.context as Record<string, unknown>) };
  if (paid.kind === "guarantee") context.escrowId = paid.escrowId;
  const [s] = await db
    .update(schema.sessions)
    .set({
      access: paid.kind,
      licenseId: paid.kind === "license" ? paid.licenseId : null,
      context,
      expiresAt: new Date(Date.now() + PAID_TTL_MS),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.access, "trial")))
    .returning();
  if (s) return s;
  // Outra chamada promoveu antes: devolve o estado atual.
  const [cur] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, session.id));
  return cur ?? session;
}

/** Encerra a sessão (licença revendida, garantia encerrada): a próxima ativação abre outra. */
export async function expireSession(sessionId: string): Promise<void> {
  await db.update(schema.sessions).set({ expiresAt: new Date(), updatedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

/**
 * Carrega a sessão garantindo que pertence à carteira do token, que o especialista não foi suspenso, que não expirou, que o teste
 * grátis não passou do teto e que a licença (se for o caso) continua com a mesma carteira.
 */
export async function getSession(sessionId: string, wallet: string): Promise<Session> {
  let [s] = await db
    .update(schema.sessions)
    .set({ calls: sql`${schema.sessions.calls} + 1` })
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.wallet, wallet)))
    .returning();
  if (!s) {
    const [other] = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    if (other) throw forbidden("This session belongs to another wallet.");
    throw notFound("Session not found. Activate the solver again with activate_solver.");
  }
  // Kill switch (PACKAGE_SPEC.md 15.4): especialista suspenso (plataforma ou cadeia) derruba as sessões abertas na hora.
  const [agent] = await db
    .select({ status: schema.agents.status, platformStatus: schema.agents.platformStatus })
    .from(schema.agents)
    .where(eq(schema.agents.id, s.agentId));
  const availability = agent ?? { status: "missing", platformStatus: "suspended" };
  // Solver aposentado: só o direito pago segue. Sessão de teste de quem comprou depois vira paga; sem direito, fecha.
  if (s.access === "trial" && servePolicy(availability) === "paid_only") {
    const paid = await paidAccessById(wallet, s.agentId);
    if (paid) s = await promoteSession(s, paid);
  }
  assertAgentCanServe(availability, s.access as AccessKind);
  if (s.expiresAt < new Date()) throw forbidden("Session expired. Activate the solver again with activate_solver.");
  if (s.access === "trial" && s.calls > TRIAL_MAX_CALLS) {
    // Só no momento de bloquear: quem comprou durante o teste segue na mesma sessão, sem limites.
    const paid = await paidAccessById(wallet, s.agentId);
    if (paid) return promoteSession(s, paid);
    throw forbidden("Free trial limit reached in this session. To continue, the user can buy the specialist.");
  }
  if (s.access === "guarantee") {
    const escrowId = (s.context as { escrowId?: unknown }).escrowId;
    if (typeof escrowId !== "string" || !(await escrowIsOpen(escrowId))) {
      throw forbidden("This specialist's guaranteed task has been closed. Activate the solver again with activate_solver.");
    }
  }
  if (s.access === "license") {
    // Licença revendida: confere o dono on-chain (sessionGrantValid cai no banco se o RPC falhar), com cache curto
    // para não bater no RPC a cada chamada.
    const key = `${s.licenseId}:${wallet}`;
    if (licenseRecheckDue(licenseChecked.get(key), Date.now())) {
      if (!s.licenseId || !(await sessionGrantValid(s))) {
        licenseChecked.delete(key);
        throw forbidden("This specialist's license no longer belongs to this wallet.");
      }
      if (licenseChecked.size > 2000) for (const [k, t] of licenseChecked) if (licenseRecheckDue(t, Date.now())) licenseChecked.delete(k);
      licenseChecked.set(key, Date.now());
    }
  }
  return s;
}

export async function advance(session: Session, resultSummary?: string): Promise<Session> {
  // O resumo recebido é da etapa anterior à que está sendo entregue (slot stepIndex - 1).
  const context = withSummary(session.context as Record<string, unknown>, resultSummary ? session.stepIndex - 1 : -1, resultSummary ?? "");
  const [s] = await db
    .update(schema.sessions)
    .set({ stepIndex: session.stepIndex + 1, context, updatedAt: new Date() })
    .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.stepIndex, session.stepIndex)))
    .returning();
  // Outra chamada avançou antes: devolve o estado atual sem pular etapa.
  return s ?? (await getSession(session.id, session.wallet));
}

/** A sessão de garantia passa a apontar para outra tarefa aberta do mesmo especialista (escolhida pelo escrow_id informado). */
export async function bindSessionEscrow(session: Session, escrowId: string): Promise<Session> {
  const context = { ...(session.context as Record<string, unknown>), escrowId };
  const [s] = await db
    .update(schema.sessions)
    .set({ context, updatedAt: new Date() })
    .where(and(eq(schema.sessions.id, session.id), eq(schema.sessions.access, "guarantee")))
    .returning();
  return s ?? session;
}

/** Reenvio de etapa (next_step repetido): só guarda o resumo no slot certo, sem avançar a sessão. */
export async function saveSummary(session: Session, slot: number, summary: string): Promise<Session> {
  const context = withSummary(session.context as Record<string, unknown>, slot, summary);
  const [s] = await db.update(schema.sessions).set({ context, updatedAt: new Date() }).where(eq(schema.sessions.id, session.id)).returning();
  return s ?? session;
}

const WATERMARKS = [
  "Follow the solver's method in order and confirm each checklist item before moving on.",
  "Complete this step's checklist before moving on to the next one.",
  "Before moving on, check every item on this step's checklist.",
  "Only go to the next step after you have validated the checklist below.",
  "Confirm this step's checklist; it is the criterion for moving on.",
  "Validate each checklist item with the user before continuing.",
  "The checklist below defines when this step is done.",
  "Use the checklist that follows as the condition for moving to the next step.",
];

/**
 * Frase de controle escolhida pelo hash da carteira (1 entre 8 = 3 bits). Serve como INDÍCIO de origem de um
 * vazamento, não como prova nem rastreio individual (PACKAGE_SPEC.md 6.5): várias carteiras caem na mesma frase.
 */
export function watermark(wallet: string, agentId: string): string {
  const n = createHash("sha256").update(`${wallet}:${agentId}`).digest().readUInt32BE(0);
  return WATERMARKS[n % WATERMARKS.length]!;
}

/** Visão geral do solver. Em sessão de teste, os templates listados são só os de `trial.templates`. */
export function overview(pkg: SolverPackage, trial: { templates: string[] } | null = null): string {
  const m = pkg.manifest;
  const steps = pkg.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
  const tools = m.tools.length ? m.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n") : "- (none)";
  return [
    `# ${m.name} v${m.version}`,
    m.tagline,
    "",
    "## Method steps",
    steps,
    "",
    "## Available server tools (use with run_tool)",
    tools,
    ...templatesOverview(declaredTemplates(m), trial),
  ].join("\n");
}

export function renderStep(pkg: SolverPackage, session: Session, index: number): { text: string; done: boolean } {
  const total = pkg.steps.length;
  if (index >= total) {
    const text = [
      `# Wrap-up (${total}/${total} steps completed)`,
      "",
      "- Summarize for the user what was delivered and the decisions made.",
      "- If you learned lasting preferences of the user, save them with save_memory (no sensitive data).",
      "- Ask whether the user wants to rate the specialist in the store.",
      "- If something was out of scope, offer escalate_to_creator.",
    ].join("\n");
    return { text, done: true };
  }
  const step = pkg.steps[index]!;
  const gate = step.gate.length ? step.gate.map((g) => `- [ ] ${g}`).join("\n") : "- [ ] Step goal achieved";
  const text = [
    `# Step ${index + 1} of ${total}: ${step.title}`,
    "",
    step.body.trim(),
    "",
    "## Exit checklist (gate)",
    watermark(session.wallet, pkg.manifest.id),
    gate,
    "",
    `When the checklist is complete, call next_step with session_id="${session.id}", completed_step=${index + 1} and result_summary in the format requested above.`,
  ].join("\n");
  return { text, done: false };
}

export const responseHash = (text: string) => sha256Hex(text);

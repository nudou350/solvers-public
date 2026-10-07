import { and, eq, inArray, ne } from "drizzle-orm";
import type { BuiltTx } from "@solvers/chain";
import type { CreatorSigningStep, PublicationConfirmInput, PublicationPlan, PublicationResult, SubmissionStatus } from "@solvers/shared";
import { unitsToUsdc } from "@solvers/shared";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { HttpError, badRequest, forbidden, notFound } from "../lib/http.js";
import { SIGNABLE_STATUSES, STEP_LABEL, approvedPriceUnits, nextPublicationStep, parseApproved, stepMismatch, type ApprovedRecord, type ChainAgentState, type PublicationStep } from "./approval-rules.js";
import type { PublishChain } from "./chain-port.js";
import type { FinalizeResult } from "./finalize.js";
import { reconcileAgent } from "./reconcile.js";

// Co-assinatura do criador (PACKAGE_SPEC.md 15.2, decisão D2): o servidor monta a transação NA HORA do clique (o blockhash
// expira em cerca de 1 minuto), paga a taxa e assina como fee payer (e com a coleção), e o criador co-assina no navegador.
// Preço, hash, nome e versão vêm SEMPRE do registro aprovado (`package_submissions.approved`), nunca do cliente.

type SubmissionRow = typeof schema.packageSubmissions.$inferSelect;

/** A submissão tem de existir e ser da carteira autenticada. */
export async function loadOwnedSubmission(submissionId: string, wallet: string): Promise<SubmissionRow> {
  const [sub] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, submissionId));
  if (!sub) throw notFound("Submission not found");
  if (sub.creatorWallet !== wallet) throw forbidden("This submission belongs to another wallet");
  return sub;
}

/** Solver novo = nenhuma versão deste agente chegou a ser publicada. */
export async function isNewAgent(sub: Pick<SubmissionRow, "id" | "agentId">): Promise<boolean> {
  const [prior] = await db
    .select({ id: schema.packageSubmissions.id })
    .from(schema.packageSubmissions)
    .where(and(eq(schema.packageSubmissions.agentId, sub.agentId), ne(schema.packageSubmissions.id, sub.id), inArray(schema.packageSubmissions.status, ["published", "superseded", "suspended", "withdrawn"])))
    .limit(1);
  return !prior;
}

const wrongState = (status: string) => new HttpError(409, "This version is not waiting for your signature right now.", "submission_state", { status });

/**
 * Monta a transação do passo pedido. Confere, nesta ordem: a carteira (dono da submissão), o estado
 * (`awaiting_creator_signature`), o registro aprovado e o passo contra a cadeia lida agora (o cliente não escolhe o passo:
 * pedir o errado dá 409 `wrong_step` com o esperado).
 */
export async function buildPublicationTx(kind: CreatorSigningStep, wallet: string, submissionId: string, port: PublishChain): Promise<BuiltTx> {
  const sub = await loadOwnedSubmission(submissionId, wallet);
  if (!SIGNABLE_STATUSES.includes(sub.status as SubmissionStatus)) throw wrongState(sub.status);
  const approved = parseApproved(sub.approved);
  if (!approved) throw new HttpError(409, "This version has not been approved by the review yet.", "not_approved");

  const state = await port.fetchAgentState(sub.agentId);
  const step = nextPublicationStep(approved, state, wallet);
  if (step === "blocked") {
    throw new HttpError(409, "This Solver is blocked on the network (suspended or owned by another wallet); contact the team.", "publication_blocked");
  }
  const expected = stepMismatch(kind, step);
  if (expected) {
    throw new HttpError(409, "This is not the right step right now.", "wrong_step", { expected, requested: kind });
  }

  let built: BuiltTx;
  if (kind === "register-agent") {
    // O programa cobra o depósito (min_stake) do criador no registro: avisa antes de ele assinar.
    const stake = await port.minStake();
    const balance = await port.usdcBalance(wallet);
    if (balance < stake) {
      throw new HttpError(400, "Not enough USDC balance for the Solver deposit", "insufficient_funds", {
        balanceUsdc: unitsToUsdc(balance),
        neededUsdc: unitsToUsdc(stake),
        faucetEnabled: env.FAUCET_ENABLED,
      });
    }
    built = await port.buildRegister(wallet, sub.agentId, approved);
  } else if (kind === "update-version") {
    built = await port.buildUpdateVersion(wallet, sub.agentId, approved);
  } else {
    built = await port.buildUpdatePricing(wallet, sub.agentId, approved);
  }
  return { ...built, meta: { ...built.meta, kind, submissionId: sub.id, submission_id: sub.id, agentId: sub.agentId } };
}

const priceOf = (units: bigint) => unitsToUsdc(units);

/** O que falta para o Solver ir ao ar, lido da cadeia agora (a tela do criador chama antes de cada passo). */
export async function publicationPlan(submissionId: string, wallet: string, port: PublishChain): Promise<PublicationPlan> {
  const sub = await loadOwnedSubmission(submissionId, wallet);
  const approved = parseApproved(sub.approved);
  const status = sub.status as SubmissionStatus;
  const newAgent = await isNewAgent(sub);
  const base = { submissionId: sub.id, status, isNewAgent: newAgent, error: sub.error ?? null };
  if (!approved) {
    return { ...base, step: null, label: null, approved: null, chain: { registered: false, version: null, priceUsdc: null, status: null }, register: null };
  }
  const state: ChainAgentState = await port.fetchAgentState(sub.agentId);
  const step: PublicationStep = nextPublicationStep(approved, state, wallet);
  let register: PublicationPlan["register"] = null;
  if (step === "register-agent" && SIGNABLE_STATUSES.includes(status)) {
    const [stake, balance] = await Promise.all([port.minStake(), port.usdcBalance(wallet)]);
    register = { stakeUsdc: priceOf(stake), balanceUsdc: priceOf(balance), faucetEnabled: env.FAUCET_ENABLED };
  }
  return {
    ...base,
    step,
    label: STEP_LABEL[step],
    approved: { name: approved.name, version: approved.version, priceUsdc: priceOf(approvedPriceUnits(approved)), royaltyBps: approved.royaltyBps },
    chain: state.exists
      ? { registered: true, version: state.version, priceUsdc: priceOf(state.price), status: state.status }
      : { registered: false, version: null, priceUsdc: null, status: null },
    register,
  };
}

const KIND_TO_TOUCH = { "register-agent": "registered", "update-version": "version", "update-pricing": "pricing" } as const;

/** Resumo do resultado (estado da submissão DEPOIS da chamada) no formato `PublicationResult`. */
export async function publicationResult(submissionId: string, result: FinalizeResult | null, port: PublishChain | null = null): Promise<PublicationResult> {
  const [sub] = await db.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, submissionId));
  if (!sub) throw notFound("Submission not found");
  let step: PublicationStep | null = result?.outcome === "not_ready" ? (result.step ?? null) : null;
  if (!step && port && result === null) {
    const approved = parseApproved(sub.approved);
    if (approved) step = nextPublicationStep(approved, await port.fetchAgentState(sub.agentId));
  }
  return {
    submissionId,
    status: sub.status as SubmissionStatus,
    outcome: result ? result.outcome : sub.status === "published" ? "already_published" : "not_ready",
    step,
    error: result?.outcome === "failed" ? result.error : (sub.error ?? null),
  };
}

/**
 * Depois de o criador enviar a transação (/tx/submit): liga a assinatura à submissão (só se ela de fato mexeu na conta
 * deste agente), grava `register_tx` e deixa o fluxo avançar (Solver novo -> `awaiting_onchain_approval`; atualização
 * completa -> publica na hora). Idempotente.
 */
export async function confirmPublication(input: PublicationConfirmInput, wallet: string, port: PublishChain): Promise<PublicationResult> {
  const sub = await loadOwnedSubmission(input.submissionId, wallet);
  const kind = input.kind ? KIND_TO_TOUCH[input.kind] : undefined;
  // O tipo de evento (quando o cliente diz qual passo foi) e o signatário (a carteira do criador) precisam bater.
  if (!(await port.signatureTouchesAgent(input.signature, sub.agentId, { kind, creatorWallet: sub.creatorWallet }))) {
    throw badRequest("This transaction does not belong to this Solver.", "signature_not_for_agent");
  }
  await port.indexSignature(input.signature).catch(() => undefined);
  const { result } = await reconcileAgent(sub.agentId, { signature: input.signature, kind: kind ?? "pricing" });
  return publicationResult(sub.id, result, port);
}

import { z } from "zod";
import { SubmissionStatus } from "./submissions.js";

// Contrato da publicação on-chain (PACKAGE_SPEC.md 15): co-assinatura do criador, estado do que falta e conclusão do
// admin. Fonte única para servidor, api-client e web. Sem I/O.

/** Os passos da publicação, na ordem. Os três primeiros são assinaturas do criador (rotas POST /tx/<passo>). */
export const PUBLICATION_STEPS = ["register-agent", "update-version", "update-pricing", "await-admin-approval", "ready", "blocked"] as const;
export const PublicationStep = z.enum(PUBLICATION_STEPS);
export type PublicationStep = z.infer<typeof PublicationStep>;

export const CREATOR_SIGNING_STEPS = ["register-agent", "update-version", "update-pricing"] as const;
export type CreatorSigningStep = (typeof CREATOR_SIGNING_STEPS)[number];

/** Corpo de POST /api/tx/register-agent | /tx/update-version | /tx/update-pricing. Nada de preço/hash/nome do cliente: o servidor lê do registro aprovado. */
export const PublicationTxInput = z.object({ submissionId: z.string().min(1).max(64) });
export type PublicationTxInput = z.infer<typeof PublicationTxInput>;

/** GET /api/tx/publication/:submissionId: o que falta para o Solver ir ao ar (lido da cadeia na hora). */
export const PublicationPlan = z.object({
  submissionId: z.string(),
  status: SubmissionStatus,
  /** Passo seguinte. `register-agent`/`update-version`/`update-pricing`: o criador chama POST /tx/<passo>. */
  step: PublicationStep.nullable(),
  /** Texto curto do passo (para a tela). */
  label: z.string().nullable(),
  isNewAgent: z.boolean(),
  approved: z.object({ name: z.string(), version: z.string(), priceUsdc: z.number(), royaltyBps: z.number() }).nullable(),
  chain: z.object({
    registered: z.boolean(),
    version: z.string().nullable(),
    priceUsdc: z.number().nullable(),
    status: z.enum(["pending", "active", "suspended", "retired"]).nullable(),
  }),
  /** Só no passo `register-agent`: o depósito (stake) que o programa cobra do criador e o saldo dele. */
  register: z.object({ stakeUsdc: z.number(), balanceUsdc: z.number(), faucetEnabled: z.boolean() }).nullable(),
  error: z.string().nullable(),
});
export type PublicationPlan = z.infer<typeof PublicationPlan>;

/** Corpo de POST /api/tx/publication/confirm (depois do /tx/submit): liga a assinatura à submissão e avança o fluxo. */
export const PublicationConfirmInput = z.object({
  submissionId: z.string().min(1).max(64),
  signature: z.string().min(60).max(100),
  /** O passo assinado (o web sabe). Sem ele, a assinatura só preenche `register_tx` se estiver vazio. */
  kind: z.enum(CREATOR_SIGNING_STEPS).optional(),
});
export type PublicationConfirmInput = z.infer<typeof PublicationConfirmInput>;

/** Resultado da finalização (confirm e POST /admin/submissions/:id/finish). */
export const FINALIZE_OUTCOMES = ["published", "already_published", "busy", "not_ready", "failed"] as const;
export const PublicationResult = z.object({
  submissionId: z.string(),
  /** Estado da submissão DEPOIS da chamada. */
  status: SubmissionStatus,
  outcome: z.enum(FINALIZE_OUTCOMES),
  /** O que ainda falta (quando `not_ready`). */
  step: PublicationStep.nullable(),
  error: z.string().nullable(),
});
export type PublicationResult = z.infer<typeof PublicationResult>;

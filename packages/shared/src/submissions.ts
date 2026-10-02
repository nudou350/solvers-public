import { z } from "zod";

// Contrato do envio de pacotes (PACKAGE_SPEC.md 14). Fonte única de estados, transições e formas de resposta
// compartilhadas por servidor, api-client e web. Regras puras: sem I/O.

export const SUBMISSION_STATUSES = [
  "submitted",
  "validating",
  "rejected_validation",
  "pending_review",
  "changes_requested",
  "rejected",
  "awaiting_creator_signature",
  "awaiting_onchain_approval",
  "publishing",
  "publish_failed",
  "published",
  "superseded",
  "suspended",
  "withdrawn",
] as const;
export const SubmissionStatus = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

/** Estados em que o criador ainda tem trabalho aberto (contam no limite de pendentes). */
export const SUBMISSION_OPEN_STATUSES: readonly SubmissionStatus[] = [
  "submitted",
  "validating",
  "pending_review",
  "changes_requested",
  "awaiting_creator_signature",
  "awaiting_onchain_approval",
  "publishing",
  "publish_failed",
];

/** Estados finais: não saem mais deles (exceto suspended/withdrawn, que voltam a published). */
export const SUBMISSION_TERMINAL_STATUSES: readonly SubmissionStatus[] = ["rejected_validation", "rejected", "superseded"];

const TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  submitted: ["validating"],
  validating: ["rejected_validation", "pending_review"],
  rejected_validation: [],
  pending_review: ["changes_requested", "rejected", "awaiting_creator_signature"],
  // O reenvio com mudanças volta a validar na MESMA submissão (mesma versão ainda não publicada).
  changes_requested: ["validating", "rejected"],
  rejected: [],
  awaiting_creator_signature: ["awaiting_onchain_approval", "publishing", "publish_failed"],
  awaiting_onchain_approval: ["publishing", "publish_failed"],
  publishing: ["published", "publish_failed"],
  publish_failed: ["publishing", "awaiting_creator_signature", "awaiting_onchain_approval"],
  published: ["superseded", "suspended", "withdrawn"],
  superseded: [],
  suspended: ["published"],
  withdrawn: ["published"],
};

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Tipos de ação do revisor registrados em `package_reviews.action`. */
export const REVIEW_ACTIONS = ["approve", "request_changes", "reject", "finish", "suspend", "resume"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Checklist do revisor (PACKAGE_SPEC.md 14.5), guardado em `package_reviews.checklist`. */
export const REVIEW_CHECKLIST_KEYS = [
  "promiseDelivered", // a promessa é entregue pelas etapas
  "twoDifferentiatorsProven", // 2 de 5 diferenciais comprovados
  "rightsAndSources", // fontes listadas e permissão para conteúdo de terceiros
  "noHarmfulInstructions", // nada contra o usuário, sem envio de dados para fora, sem injeção
  "priceTrialShowcaseCoherent", // preço, teste grátis e vitrine coerentes; sem promessa financeira/jurídica/médica
] as const;
export const ReviewChecklist = z.object(Object.fromEntries(REVIEW_CHECKLIST_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof REVIEW_CHECKLIST_KEYS)[number], z.ZodBoolean>);
export type ReviewChecklist = z.infer<typeof ReviewChecklist>;

/** A aprovação exige o checklist inteiro marcado e um motivo/nota (rejeitar e pedir mudanças exigem motivo). */
export function reviewChecklistComplete(c: Partial<Record<string, boolean>>): boolean {
  return REVIEW_CHECKLIST_KEYS.every((k) => c[k] === true);
}

export const ValidationIssue = z.object({
  code: z.string(),
  path: z.string().optional(),
  message: z.string(),
  fix: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationReport = z.object({
  ok: z.boolean(),
  errors: z.array(ValidationIssue),
  warnings: z.array(ValidationIssue),
  stats: z.record(z.unknown()).optional(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

/** Visão da submissão para o criador (GET /api/creator/submissions[/:id]). */
export const SubmissionView = z.object({
  id: z.string(),
  agentId: z.string(),
  slug: z.string(),
  version: z.string(),
  status: SubmissionStatus,
  name: z.string().nullable(),
  sizeBytes: z.number(),
  validation: ValidationReport.nullable(),
  /** Motivo do revisor (mudanças pedidas ou recusa). */
  reviewerNotes: z.string().nullable(),
  /** Passo seguinte do criador, calculado pelo servidor: nada, co-assinar, aguardar o admin, etc. */
  nextAction: z.enum(["none", "fix_and_resubmit", "sign_register", "sign_update", "wait_review", "wait_admin_approval", "wait_publish"]),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubmissionView = z.infer<typeof SubmissionView>;

export function nextActionFor(status: SubmissionStatus, isNewAgent: boolean): SubmissionView["nextAction"] {
  switch (status) {
    case "rejected_validation":
    case "changes_requested":
      return "fix_and_resubmit";
    case "awaiting_creator_signature":
      return isNewAgent ? "sign_register" : "sign_update";
    case "submitted":
    case "validating":
    case "pending_review":
      return "wait_review";
    case "awaiting_onchain_approval":
      return "wait_admin_approval";
    case "publishing":
    case "publish_failed":
      return "wait_publish";
    default:
      return "none";
  }
}

/** Perfil do criador (POST /api/creator/profile). */
export const CreatorProfileInput = z.object({
  name: z.string().trim().min(2).max(60),
  bio: z.string().trim().min(10).max(500),
  acceptTerms: z.literal(true),
  /** Obrigatório só no 1º cadastro (convite ainda não usado). */
  inviteCode: z.string().trim().min(6).max(64).optional(),
});
export type CreatorProfileInput = z.infer<typeof CreatorProfileInput>;

export const CreatorMe = z.object({
  wallet: z.string(),
  hasProfile: z.boolean(),
  invited: z.boolean(),
  termsAccepted: z.boolean(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  /** Contato de escalonamento verificado (Telegram vinculado). */
  contactVerified: z.boolean(),
  canSubmit: z.boolean(),
  isAdmin: z.boolean(),
});
export type CreatorMe = z.infer<typeof CreatorMe>;

/** Regra de slugs que não podem ser pedidos por terceiros (marcas e a plataforma). */
export const RESERVED_SLUGS: readonly string[] = ["solvers", "criador-de-solvers", "admin", "api", "mcp", "oauth", "wondervelop", "anthropic", "claude", "openai", "chatgpt", "solana", "metaplex", "usdc"];

/** Categorias permitidas para criadores de terceiros no Núcleo (D13); Finanças, Jurídico e saúde ficam de fora. */
export const THIRD_PARTY_CATEGORIES: readonly string[] = ["Desenvolvimento", "Design", "Dia a dia", "Negócios", "Viagens", "Conteúdo", "Escrita", "Outros"];

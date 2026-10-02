import { CREATOR_SIGNING_STEPS, type CreatorSigningStep, type PublicationStep, type SubmissionStatus } from "@solvers/shared";

// Regras puras da publicação on-chain (PACKAGE_SPEC.md 15.2 e 15.3). Sem env, banco nem rede: testadas em
// test/publish-rules.test.ts. Tudo parte de DUAS coisas: a versão aprovada (congelada na aprovação) e o estado da conta
// on-chain lido na hora. O passo seguinte nunca vem do cliente.

/** Versão aprovada, como `package_submissions.approved` a guarda (preço em unidades de 6 casas, string). */
export type ApprovedRecord = { versionHash: string; priceUsdc: string; royaltyBps: number; name: string; version: string };

export type OnchainStatus = "pending" | "active" | "suspended" | "retired";

/** A conta do agente na cadeia (versão e preço já decodificados). */
export type ChainAgentState =
  | { exists: false }
  | { exists: true; address: string; creator: string; version: string; versionHash: string; price: bigint; status: OnchainStatus };

/**
 * Um passo é uma assinatura do criador (`register-agent`, `update-version`, `update-pricing`) ou algo que não é dele:
 * `await-admin-approval` (Solver novo registrado: falta o approve_agent do admin), `ready` (a cadeia está como o aprovado e
 * o agente está Active: pode finalizar) e `blocked` (suspenso/aposentado na cadeia ou conta de outro criador).
 */
export type { PublicationStep };

/** Os passos que o criador assina. */
export type CreatorStep = CreatorSigningStep;
export const isCreatorStep = (s: PublicationStep): s is CreatorStep => (CREATOR_SIGNING_STEPS as readonly string[]).includes(s);

export function approvedPriceUnits(a: ApprovedRecord): bigint {
  return BigInt(a.priceUsdc);
}

/** `approved` vindo do jsonb: confere o formato antes de confiar nele (a transação on-chain lê tudo daqui). */
export function parseApproved(raw: unknown): ApprovedRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.versionHash === "string" &&
    /^[0-9a-f]{64}$/.test(r.versionHash) &&
    typeof r.priceUsdc === "string" &&
    /^\d{1,19}$/.test(r.priceUsdc) &&
    typeof r.royaltyBps === "number" &&
    Number.isInteger(r.royaltyBps) &&
    r.royaltyBps >= 0 &&
    r.royaltyBps <= 10_000 &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    typeof r.version === "string" &&
    r.version.length > 0
  ) {
    return { versionHash: r.versionHash, priceUsdc: r.priceUsdc, royaltyBps: r.royaltyBps, name: r.name, version: r.version };
  }
  return null;
}

/**
 * O que falta para publicar, comparando a cadeia com o aprovado. Ordem: registrar (não existe) -> versão (hash ou
 * versão diferentes) -> preço -> aprovação do admin (Pending) -> pronto (Active). Idempotente: depois de cada
 * transação confirmada o passo avança sozinho, sem estado guardado.
 *
 * `wallet` (opcional) é a carteira de quem pergunta: a conta on-chain de OUTRO criador bloqueia (`has_one = creator`
 * recusaria a transação de qualquer jeito).
 */
export function nextPublicationStep(approved: ApprovedRecord, chain: ChainAgentState, wallet?: string): PublicationStep {
  if (!chain.exists) return "register-agent";
  if (wallet && chain.creator !== wallet) return "blocked";
  if (chain.version !== approved.version || chain.versionHash.toLowerCase() !== approved.versionHash.toLowerCase()) return "update-version";
  if (chain.price !== approvedPriceUnits(approved)) return "update-pricing";
  if (chain.status === "pending") return "await-admin-approval";
  if (chain.status === "active") return "ready";
  return "blocked";
}

/** Estados da submissão em que o criador ainda pode co-assinar. */
export const SIGNABLE_STATUSES: readonly SubmissionStatus[] = ["awaiting_creator_signature"];

/** Estados de onde a finalização pode partir (inclui `publishing`: retomada de um processo que caiu). */
export const FINALIZABLE_STATUSES: readonly SubmissionStatus[] = ["awaiting_creator_signature", "awaiting_onchain_approval", "publishing", "publish_failed"];

/**
 * Estado da submissão depois de ler a cadeia (nunca regride): `ready` -> finalizar; `await-admin-approval` ->
 * `awaiting_onchain_approval`; o resto continua esperando o criador.
 */
export function statusAfterChain(current: SubmissionStatus, step: PublicationStep): SubmissionStatus | "finalize" {
  if (!FINALIZABLE_STATUSES.includes(current)) return current;
  if (step === "ready") return "finalize";
  if (step === "await-admin-approval" && current === "awaiting_creator_signature") return "awaiting_onchain_approval";
  return current;
}

/** Rótulo curto do passo para o criador/admin (o web mostra; nunca é código de decisão). */
export const STEP_LABEL: Record<PublicationStep, string> = {
  "register-agent": "Registrar o Solver na rede (sua assinatura)",
  "update-version": "Publicar a nova versão na rede (sua assinatura)",
  "update-pricing": "Atualizar o preço na rede (sua assinatura)",
  "await-admin-approval": "Aguardando a aprovação final da equipe",
  ready: "Pronto para ir ao ar",
  blocked: "Bloqueado: o Solver está suspenso ou pertence a outra carteira na rede",
};

/** O passo pedido pela rota bate com o que a cadeia diz? Devolve o passo esperado quando não bate. */
export function stepMismatch(requested: CreatorStep, actual: PublicationStep): PublicationStep | null {
  return requested === actual ? null : actual;
}

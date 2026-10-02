import { randomBytes } from "node:crypto";
import {
  canTransition,
  nextActionFor,
  reviewChecklistComplete,
  SUBMISSION_OPEN_STATUSES,
  usdcToUnits,
  type AdminSubmissionRow,
  type SubmissionStatus,
  type SubmissionView,
  type ValidationReport,
} from "@solvers/shared";
import { relativePathProblem } from "../runtime/package-paths.js";
import type { ZipIssue } from "./zip.js";

// Regras puras do envio e da revisão de pacotes (PACKAGE_SPEC.md 14). Sem banco, disco ou rede: testadas em
// test/submission-rules.test.ts. Os handlers (upload, worker, revisão) só orquestram.

/** Piso de preço (USDC com 6 casas) enquanto a config on-chain não responde: o `min_price` do programa é 5 USDC. */
export const DEFAULT_MIN_PRICE_UNITS = 5_000_000n;
export const MAX_ROYALTY_BPS = 1000;

// ---------------------------------------------------------------------------------------------------------------
// Administradores

/** Carteiras de `ADMIN_WALLETS` (separadas por vírgula), sem espaços nem vazios. */
export function adminWallets(list: string): Set<string> {
  return new Set(
    list
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean),
  );
}

export const isAdminWallet = (wallet: string | undefined, list: string): boolean => !!wallet && adminWallets(list).has(wallet);

// ---------------------------------------------------------------------------------------------------------------
// Convites

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I: o código vai por e-mail e é digitado

/** Código de convite legível, ex.: `SLV-7KQ2-M9XD-4TPA` (12 caracteres de 32 símbolos: ~60 bits). */
export function generateInviteCode(bytes: Uint8Array = randomBytes(12)): string {
  const chars = Array.from(bytes.slice(0, 12), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!).join("");
  return `SLV-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** O que o criador digitou vira a chave do banco: maiúsculas, sem espaços. */
export const normalizeInviteCode = (raw: string): string => raw.trim().toUpperCase().replace(/\s+/g, "");

// ---------------------------------------------------------------------------------------------------------------
// Quem pode enviar e quantos

export type CreatorGate = { invited: boolean; termsAcceptedAt: Date | null } | undefined;

/** Motivo pelo qual o criador ainda não pode enviar pacote, ou null. */
export function creatorNotReady(c: CreatorGate): string | null {
  if (!c) return "Complete seu perfil de criador antes de enviar um pacote.";
  if (!c.invited) return "O envio de pacotes é só para criadores convidados.";
  if (!c.termsAcceptedAt) return "Aceite os termos do criador antes de enviar um pacote.";
  return null;
}

export type UploadLimits = { maxPending: number; maxPerDay: number };

/** 429 quando o criador já tem pendentes demais ou enviou demais nas últimas 24 h. */
export function uploadLimitProblem(counts: { pending: number; last24h: number }, limits: UploadLimits): { code: string; message: string } | null {
  if (counts.pending >= limits.maxPending) {
    return { code: "too_many_pending", message: `Você já tem ${counts.pending} envio(s) em andamento (limite: ${limits.maxPending}). Aguarde a revisão antes de enviar outro.` };
  }
  if (counts.last24h >= limits.maxPerDay) {
    return { code: "too_many_per_day", message: `Limite de ${limits.maxPerDay} envios por dia atingido. Tente de novo amanhã.` };
  }
  return null;
}

export const isOpenStatus = (s: string): boolean => (SUBMISSION_OPEN_STATUSES as readonly string[]).includes(s);

/** Só um envio que pediu mudanças aceita novo ZIP na mesma submissão. */
export const canResubmit = (status: string): boolean => status === "changes_requested";

// ---------------------------------------------------------------------------------------------------------------
// Relatório de validação (o que vai para o criador e para o revisor)

type Issue = { code: string; path?: string; message: string; fix?: string };

/** Relatório com a mesma forma da saída do validador, a partir dos erros do extrator de ZIP. */
export function reportFromZip(errors: ZipIssue[], warnings: ZipIssue[] = []): ValidationReport {
  return { ok: false, errors: errors.map(toIssue), warnings: warnings.map(toIssue), stats: { files: 0 } };
}

const toIssue = (i: ZipIssue | Issue): Issue => ({ code: i.code, path: i.path, message: i.message, fix: i.fix });

/** Junta avisos do extrator (lixo removido) aos do validador, sem repetir o mesmo código e caminho. */
export function mergeWarnings(validator: Issue[], zip: ZipIssue[]): Issue[] {
  const seen = new Set(validator.map((w) => `${w.code}|${w.path ?? ""}`));
  return [...validator, ...zip.filter((w) => !seen.has(`${w.code}|${w.path}`)).map(toIssue)];
}

export function countIssues(validation: unknown): { errors: number; warnings: number } {
  const v = validation as { errors?: unknown[]; warnings?: unknown[] } | null;
  return { errors: v?.errors?.length ?? 0, warnings: v?.warnings?.length ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Manifesto no envio

/**
 * O servidor é a autoridade do `id` e do `creator.id` (PACKAGE_SPEC.md 4.1): `id` é atribuído na 1ª versão e `creator.id` é
 * sempre sobrescrito pelo identificador do perfil. Nome e bio do criador continuam os do manifesto (a vitrine usa o perfil).
 */
export function normalizeManifest(raw: Record<string, unknown>, ids: { agentId: string; creatorId: string }): Record<string, unknown> {
  const creator = raw.creator && typeof raw.creator === "object" && !Array.isArray(raw.creator) ? (raw.creator as Record<string, unknown>) : {};
  return { ...raw, id: ids.agentId, creator: { ...creator, id: ids.creatorId } };
}

/** `slug`, `version` e `name` só entram na linha da submissão quando têm formato seguro (mesmo reprovado, ajuda a achar o envio). */
export function safeManifestFields(raw: unknown): { slug?: string; version?: string; name?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const m = raw as Record<string, unknown>;
  const out: { slug?: string; version?: string; name?: string } = {};
  if (typeof m.slug === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.slug) && m.slug.length <= 40) out.slug = m.slug;
  if (typeof m.version === "string" && /^\d+\.\d+\.\d+$/.test(m.version) && m.version.length <= 16) out.version = m.version;
  if (typeof m.name === "string" && m.name.trim()) out.name = m.name.slice(0, 80);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Aprovação

export type Approved = { versionHash: string; priceUsdc: string; royaltyBps: number; name: string; version: string };

/** Preço do manifesto em unidades de 6 casas; recusa NaN, negativo e mais casas que o USDC tem. */
export function priceToUnits(priceUsdc: unknown): bigint | null {
  if (typeof priceUsdc !== "number" || !Number.isFinite(priceUsdc) || priceUsdc <= 0) return null;
  const units = usdcToUnits(priceUsdc);
  // 9.9999999 não vira 10.000000: o que o criador escreveu precisa caber exatamente em 6 casas.
  return Math.abs(Number(units) / 1_000_000 - priceUsdc) < 1e-9 ? units : null;
}

export type ApprovalPlan = { ok: true; approved: Approved; priceUnits: bigint } | { ok: false; status: number; code: string; message: string };

/**
 * Confere o que a aprovação vai congelar: preço >= min_price e royaltyBps de 0 a 1000. O preço sai do MANIFESTO enviado
 * (nunca do corpo da requisição do admin) e o hash vem da pasta extraída, calculado por quem chama.
 */
export function planApproval(args: {
  status: string;
  validation: unknown;
  manifest: Record<string, unknown> | null;
  checklist: Record<string, boolean>;
  versionHash: string;
  minPriceUnits: bigint;
}): ApprovalPlan {
  const fail = (status: number, code: string, message: string): ApprovalPlan => ({ ok: false, status, code, message });
  if (reviewTransitionProblem(args.status, "approve")) {
    return fail(409, "invalid_state", `Não dá para aprovar uma submissão em "${args.status}".`);
  }
  if (!(args.validation as ValidationReport | null)?.ok) return fail(409, "validation_failed", "O validador não aprovou este pacote.");
  if (!reviewChecklistComplete(args.checklist)) return fail(400, "checklist_incomplete", "Marque todo o checklist da revisão para aprovar.");
  const m = args.manifest;
  if (!m) return fail(409, "no_manifest", "A submissão não tem manifesto.");
  const pricing = (m.pricing ?? {}) as { priceUsdc?: unknown; royaltyBps?: unknown };
  const units = priceToUnits(pricing.priceUsdc);
  if (units === null) return fail(400, "price_invalid", "O preço do manifesto não é um valor em USDC válido (até 6 casas decimais).");
  if (units < args.minPriceUnits) return fail(400, "price_below_min", `O preço está abaixo do mínimo da plataforma (${Number(args.minPriceUnits) / 1_000_000} USDC).`);
  const bps = pricing.royaltyBps;
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > MAX_ROYALTY_BPS) {
    return fail(400, "royalty_invalid", `royaltyBps precisa ser um inteiro de 0 a ${MAX_ROYALTY_BPS}.`);
  }
  if (typeof m.name !== "string" || typeof m.version !== "string") return fail(409, "no_manifest", "O manifesto não tem nome e versão válidos.");
  return { ok: true, priceUnits: units, approved: { versionHash: args.versionHash, priceUsdc: units.toString(), royaltyBps: bps, name: m.name, version: m.version } };
}

/** Ação do revisor que muda o estado: para onde vai e de quais estados parte. Toda ação respeita `canTransition` E esta lista. */
export const REVIEW_TRANSITIONS = {
  // publish_failed -> awaiting_creator_signature também é uma transição válida, mas é a retomada da publicação (admin), não uma aprovação.
  approve: { to: "awaiting_creator_signature", from: ["pending_review"] },
  request_changes: { to: "changes_requested", from: ["pending_review"] },
  reject: { to: "rejected", from: ["pending_review", "changes_requested"] },
} as const satisfies Record<string, { to: SubmissionStatus; from: readonly SubmissionStatus[] }>;

export function reviewTransitionProblem(from: string, action: keyof typeof REVIEW_TRANSITIONS): string | null {
  const rule = REVIEW_TRANSITIONS[action];
  const allowed = (rule.from as readonly string[]).includes(from) && canTransition(from as SubmissionStatus, rule.to);
  if (allowed) return null;
  const what = action === "approve" ? "aprovar" : action === "reject" ? "recusar" : "pedir mudanças em";
  return `Não dá para ${what} uma submissão em "${from}".`;
}

// ---------------------------------------------------------------------------------------------------------------
// Prévia do revisor

/** Caminho pedido pela tela de revisão (`?path=`): relativo, sem `..`, dentro do pacote. */
export function reviewPathProblem(path: unknown): string | null {
  if (typeof path !== "string") return "informe o caminho do arquivo";
  return relativePathProblem(path, [""]);
}

// ---------------------------------------------------------------------------------------------------------------
// Formas de resposta

type SubmissionRowLike = {
  id: string;
  agentId: string;
  slug: string;
  version: string;
  status: string;
  manifest: Record<string, unknown> | null;
  sizeBytes: number;
  validation: Record<string, unknown> | null;
  reviewerNotes: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Visão do criador: nunca expõe caminhos de disco, o manifesto inteiro nem dados da revisão interna. */
export function toSubmissionView(row: SubmissionRowLike, isNewAgent: boolean): SubmissionView {
  const name = typeof row.manifest?.name === "string" ? row.manifest.name : null;
  return {
    id: row.id,
    agentId: row.agentId,
    slug: row.slug,
    version: row.version,
    status: row.status as SubmissionStatus,
    name,
    sizeBytes: row.sizeBytes,
    validation: (row.validation as ValidationReport | null) ?? null,
    reviewerNotes: row.reviewerNotes,
    nextAction: nextActionFor(row.status as SubmissionStatus, isNewAgent),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminRow(row: SubmissionRowLike, creator: { wallet: string; name: string | null }, isNewAgent: boolean): AdminSubmissionRow {
  const { errors, warnings } = countIssues(row.validation);
  return {
    id: row.id,
    slug: row.slug,
    name: typeof row.manifest?.name === "string" ? row.manifest.name : null,
    version: row.version,
    creatorWallet: creator.wallet,
    creatorName: creator.name,
    status: row.status as SubmissionStatus,
    isNewAgent,
    errors,
    warnings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Diferenciais declarados × comprovados pelo validador (`stats.differentiators`). */
export function differentiatorsOf(manifest: Record<string, unknown> | null, validation: Record<string, unknown> | null): { declared: string[]; proven: string[] } {
  const declared = Array.isArray(manifest?.differentiators) ? (manifest.differentiators as unknown[]).filter((d): d is string => typeof d === "string") : [];
  const stats = (validation as { stats?: { differentiators?: unknown } } | null)?.stats;
  const proven = Array.isArray(stats?.differentiators) ? (stats.differentiators as unknown[]).filter((d): d is string => typeof d === "string") : [];
  return { declared, proven };
}

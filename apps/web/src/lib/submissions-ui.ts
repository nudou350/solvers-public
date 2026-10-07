// Textos e regras de tela do envio de pacotes (PACKAGE_SPEC.md 14.2), em linguagem simples.
// Funções puras: sem React e sem I/O. Os estados e as transições vêm de @solvers/shared.
import type { SubmissionStatus, SubmissionView } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";

/** Limite do ZIP validado no navegador (o servidor confere de novo). */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
/** Especialista da plataforma que ajuda a montar o pacote. */
export const CREATOR_SOLVER_SLUG = "criador-de-solvers";

/** Função de tradução do namespace "submissions" (useTranslations / getTranslations). */
export type Tr = (key: string, values?: Record<string, string | number>) => string;

/** Prazo que o criador vê na fila (PACKAGE_SPEC.md 14.5). */
export const reviewSlaText = (t: Tr): string => t("sla");

export type Tone = "ok" | "warn" | "bad" | "brand" | "plain";

export type StatusInfo = { label: string; text: string; tone: Tone };

const STATUS_TONE: Record<SubmissionStatus, Tone> = {
  submitted: "brand",
  validating: "brand",
  rejected_validation: "bad",
  pending_review: "brand",
  changes_requested: "warn",
  rejected: "bad",
  awaiting_creator_signature: "warn",
  awaiting_onchain_approval: "brand",
  publishing: "brand",
  publish_failed: "warn",
  published: "ok",
  superseded: "plain",
  suspended: "bad",
  withdrawn: "plain",
};

/** Rótulo curto (chip) e explicação de cada estado. `nextAction` só muda o texto da co-assinatura. */
export function statusInfo(t: Tr, status: SubmissionStatus, nextAction?: SubmissionView["nextAction"]): StatusInfo {
  const tone = STATUS_TONE[status];
  if (status === "awaiting_creator_signature") {
    return { label: t(`status.${status}.label`), text: t(nextAction === "sign_update" ? `status.${status}.textUpdate` : `status.${status}.textRegister`), tone };
  }
  if (status === "pending_review") return { label: t(`status.${status}.label`), text: t(`status.${status}.text`, { sla: reviewSlaText(t) }), tone };
  return { label: t(`status.${status}.label`), text: t(`status.${status}.text`), tone };
}

export const CHIP_TONE: Record<Tone, "ok" | "warn" | "red" | "brand" | "default"> = { ok: "ok", warn: "warn", bad: "red", brand: "brand", plain: "default" };

/** Etapas da linha do tempo, na ordem em que acontecem (textos em stages.<key>.title/text). */
export const STAGES = [{ key: "sent" }, { key: "check" }, { key: "review" }, { key: "sign" }, { key: "final" }, { key: "publish" }] as const;

/** Título e texto de uma etapa da linha do tempo. */
export function stageInfo(t: Tr, key: (typeof STAGES)[number]["key"]): { title: string; text: string } {
  return { title: t(`stages.${key}.title`), text: key === "review" ? t("stages.review.text", { sla: reviewSlaText(t) }) : t(`stages.${key}.text`) };
}

export type StageState = "done" | "current" | "attention" | "failed" | "todo" | "skipped";

/** Estado de cada etapa da linha do tempo para um envio. */
export function stageStates(status: SubmissionStatus, nextAction?: SubmissionView["nextAction"]): StageState[] {
  // Posição da etapa atual e como ela está.
  let at = 0;
  let mode: "current" | "attention" | "failed" = "current";
  switch (status) {
    case "submitted":
      at = 0;
      break;
    case "validating":
      at = 1;
      break;
    case "rejected_validation":
      at = 1;
      mode = "failed";
      break;
    case "pending_review":
      at = 2;
      break;
    case "changes_requested":
      at = 2;
      mode = "attention";
      break;
    case "rejected":
      at = 2;
      mode = "failed";
      break;
    case "awaiting_creator_signature":
      at = 3;
      mode = "attention";
      break;
    case "awaiting_onchain_approval":
      at = 4;
      break;
    case "publishing":
      at = 5;
      break;
    case "publish_failed":
      at = 5;
      mode = "attention";
      break;
    case "published":
    case "superseded":
    case "suspended":
    case "withdrawn":
      at = STAGES.length;
      break;
  }
  // Em atualização de especialista já aprovado, a aprovação final é pulada (PACKAGE_SPEC.md 14.2).
  const skipFinal = nextAction === "sign_update";
  return STAGES.map((_, i) => {
    if (i === 4 && skipFinal) return "skipped";
    if (i < at) return "done";
    if (i === at) return mode;
    return "todo";
  });
}

/** Um envio ainda aceita reenvio corrigido pelo criador? */
export const canResubmit = (s: SubmissionView): boolean => s.nextAction === "fix_and_resubmit";

/** Mensagem do erro de envio do ZIP (XHR) ou de qualquer chamada, sem jargão (textos em uploadError.*). */
export function uploadErrorInfo(t: Tr, err: unknown): { title: string; text: string } {
  const pick = (k: string, server?: string) => ({ title: t(`uploadError.${k}.title`), text: server || t(`uploadError.${k}.text`) });
  if (err instanceof ApiError) {
    const server = err.message && err.message !== "Bad Request" && err.message !== "error" ? err.message : "";
    switch (true) {
      case err.status === 0 && err.code === "aborted":
        return pick("aborted");
      case err.status === 0:
        return pick("network");
      case err.status === 401:
        return pick("unauthorized");
      case err.status === 403:
        return pick("forbidden", server);
      case err.status === 409:
        return pick("conflict", server);
      case err.status === 413:
        return pick("tooLarge");
      case err.status === 429:
        return pick("rateLimited", server);
      case err.status === 400 || err.status === 415 || err.status === 422:
        return pick("rejected", server);
      case err.status >= 500:
        return pick("serverError");
      default:
        return pick("generic", server);
    }
  }
  return { title: t("uploadError.generic.title"), text: err instanceof Error && err.message ? err.message : t("uploadError.generic.text") };
}

/**
 * Mensagem curta para falhas de leitura (listas e detalhes). `fallback` (useErrorText) traduz o resto pelo código da API;
 * sem ele, vale a mensagem que veio.
 */
export function loadErrorText(t: Tr, err: unknown, fallback?: (e: unknown) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return t("loadError.unauthorized");
    if (err.status === 403) return t("loadError.forbidden");
    if (err.status >= 500) return t("loadError.serverError");
    return fallback ? fallback(err) : err.message;
  }
  return err instanceof Error ? (fallback ? fallback(err) : err.message) : t("loadError.generic");
}

// ----- Segurança do conteúdo do criador (revisão) -----

/**
 * Caracteres que não aparecem na tela mas mudam o que o revisor lê: largura zero, controle de direção (bidi),
 * marcas de formatação, separadores de linha, seletores de variação, "tags" e caracteres de controle (exceto tab e quebras).
 * Em pontos de código (e não em regex com escapes) para o arquivo não depender de como o editor trata esses caracteres.
 */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe0fff],
];

const isHidden = (cp: number): boolean => HIDDEN_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

/** Troca cada caractere invisível por uma marca visível (por exemplo `[U+200B]`), para o revisor ver o que a prévia esconderia. */
export function revealHidden(text: string): { text: string; count: number } {
  let count = 0;
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isHidden(cp)) {
      count++;
      out += `[U+${cp.toString(16).toUpperCase().padStart(4, "0")}]`;
    } else out += ch;
  }
  return { text: out, count };
}

/** JSON para exibir como texto (nunca como HTML). Valores que não cabem em JSON viram texto simples. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

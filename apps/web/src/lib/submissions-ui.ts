// Textos e regras de tela do envio de pacotes (PACKAGE_SPEC.md 14.2), em linguagem simples.
// Funções puras: sem React e sem I/O. Os estados e as transições vêm de @solvers/shared.
import type { SubmissionStatus, SubmissionView } from "@solvers/api-client";
import { ApiError } from "@solvers/api-client";

/** Limite do ZIP validado no navegador (o servidor confere de novo). */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
/** Prazo que o criador vê na fila (PACKAGE_SPEC.md 14.5). */
export const REVIEW_SLA_TEXT = "Nossa meta é responder em até 5 dias úteis.";
/** Especialista da plataforma que ajuda a montar o pacote. */
export const CREATOR_SOLVER_SLUG = "criador-de-solvers";

export type Tone = "ok" | "warn" | "bad" | "brand" | "plain";

export type StatusInfo = { label: string; text: string; tone: Tone };

/** Rótulo curto (chip) e explicação de cada estado. `isNew` só muda o texto da co-assinatura. */
export function statusInfo(status: SubmissionStatus, nextAction?: SubmissionView["nextAction"]): StatusInfo {
  switch (status) {
    case "submitted":
      return { label: "Recebido", text: "Recebemos o seu pacote. Ele entra na conferência automática em instantes.", tone: "brand" };
    case "validating":
      return { label: "Conferindo", text: "Estamos conferindo o formato, as etapas e o conhecimento do pacote. Leva poucos minutos.", tone: "brand" };
    case "rejected_validation":
      return { label: "Tem erros", text: "A conferência automática achou erros. Corrija o que está listado abaixo e envie o pacote de novo. Nada foi para a revisão da equipe.", tone: "bad" };
    case "pending_review":
      return { label: "Na fila da revisão", text: `A equipe vai ler o pacote inteiro. ${REVIEW_SLA_TEXT}`, tone: "brand" };
    case "changes_requested":
      return { label: "Mudanças pedidas", text: "A equipe pediu ajustes. Leia o recado abaixo, corrija o pacote e envie de novo: a versão é a mesma.", tone: "warn" };
    case "rejected":
      return { label: "Recusado", text: "A equipe não aprovou este pacote. O motivo está abaixo. Você pode enviar um pacote novo quando quiser.", tone: "bad" };
    case "awaiting_creator_signature":
      return nextAction === "sign_update"
        ? { label: "Falta a sua confirmação", text: "A equipe aprovou a nova versão. Falta você confirmar a atualização com a sua conta.", tone: "warn" }
        : { label: "Falta a sua confirmação", text: "A equipe aprovou o seu especialista. Falta você confirmar o cadastro com a sua conta.", tone: "warn" };
    case "awaiting_onchain_approval":
      return { label: "Aprovação final", text: "Você já confirmou. Falta a aprovação final da equipe para o especialista entrar na vitrine. Você não precisa fazer nada.", tone: "brand" };
    case "publishing":
      return { label: "Publicando", text: "Estamos colocando o especialista no ar. Leva alguns instantes.", tone: "brand" };
    case "publish_failed":
      return { label: "Publicação travou", text: "A publicação não terminou. A equipe foi avisada e vai tentar de novo. Você não precisa fazer nada.", tone: "warn" };
    case "published":
      return { label: "No ar", text: "O especialista está publicado na vitrine.", tone: "ok" };
    case "superseded":
      return { label: "Substituído", text: "Existe uma versão mais nova deste especialista. Esta não é mais a versão do ar.", tone: "plain" };
    case "suspended":
      return { label: "Suspenso", text: "A plataforma suspendeu este especialista. Fale com a equipe para entender o motivo.", tone: "bad" };
    case "withdrawn":
      return { label: "Retirado", text: "Este especialista foi retirado da vitrine a pedido do criador.", tone: "plain" };
  }
}

export const CHIP_TONE: Record<Tone, "ok" | "warn" | "red" | "brand" | "default"> = { ok: "ok", warn: "warn", bad: "red", brand: "brand", plain: "default" };

/** Etapas da linha do tempo, na ordem em que acontecem. */
export const STAGES = [
  { key: "sent", title: "Enviado", text: "O pacote chegou ao servidor." },
  { key: "check", title: "Conferência automática", text: "Formato, etapas e conhecimento." },
  { key: "review", title: "Revisão da equipe", text: `Leitura humana do pacote. ${REVIEW_SLA_TEXT}` },
  { key: "sign", title: "Sua confirmação", text: "Você confirma o cadastro ou a nova versão com a sua conta." },
  { key: "final", title: "Aprovação final", text: "Só em especialistas novos: a equipe libera a entrada na vitrine." },
  { key: "publish", title: "Publicação", text: "O especialista entra na vitrine." },
] as const;

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

/** Mensagem do erro de envio do ZIP (XHR) ou de qualquer chamada, em português e sem jargão. */
export function uploadErrorInfo(err: unknown): { title: string; text: string } {
  if (err instanceof ApiError) {
    const server = err.message && err.message !== "Bad Request" && err.message !== "error" ? err.message : "";
    switch (true) {
      case err.status === 0 && err.code === "aborted":
        return { title: "Envio cancelado", text: "Nada foi enviado. Escolha o arquivo e tente de novo." };
      case err.status === 0:
        return { title: "A conexão caiu", text: "O envio foi interrompido antes de terminar. Confira a sua internet e tente de novo." };
      case err.status === 401:
        return { title: "Sua sessão expirou", text: "Entre de novo e envie o arquivo outra vez." };
      case err.status === 403:
        return { title: "Seu cadastro ainda não permite enviar", text: server || "Complete o cadastro de criador (convite, termos e contato) antes de enviar." };
      case err.status === 409:
        return { title: "Esta versão já existe", text: server || "Já há um envio ou uma versão publicada com esse nome e versão. Aumente a versão no manifesto e envie de novo." };
      case err.status === 413:
        return { title: "O arquivo é grande demais", text: "O limite é 50 MB. Tire arquivos que não fazem parte do pacote (imagens pesadas, cópias) e compacte de novo." };
      case err.status === 429:
        return {
          title: "Você chegou ao limite de envios",
          text: server || "São no máximo 3 envios em andamento e 5 por dia. Espere uma revisão terminar ou tente de novo amanhã.",
        };
      case err.status === 400 || err.status === 415 || err.status === 422:
        return { title: "O servidor não aceitou o arquivo", text: server || "Confira se é um ZIP com o manifest.json na raiz e tente de novo." };
      case err.status >= 500:
        return { title: "O servidor não respondeu bem", text: "Nada foi perdido. Tente de novo em instantes." };
      default:
        return { title: "Não deu para enviar", text: server || "Tente de novo em instantes." };
    }
  }
  return { title: "Não deu para enviar", text: err instanceof Error && err.message ? err.message : "Tente de novo em instantes." };
}

/** Mensagem curta para falhas de leitura (listas e detalhes). */
export function loadErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Sua sessão expirou. Entre de novo.";
    if (err.status === 403) return "Você não tem acesso a esta página.";
    if (err.status >= 500) return "O servidor não respondeu agora. Tente de novo em instantes.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Não deu para carregar agora.";
}

export function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
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

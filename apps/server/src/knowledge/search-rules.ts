// Regras puras do search_knowledge (PACKAGE_SPEC.md 6.3 e 6.5): texto dos trechos com fonte, data e aviso
// de validade, cota diária e teste grátis dos pacotes v1. Sem env nem banco: test/knowledge-search.test.ts.

export type HitView = {
  /** Caminho do arquivo dentro do pacote (knowledge/x.md). */
  source: string;
  content: string;
  /** Front-matter do arquivo; null em pacotes v0. */
  meta: Record<string, unknown> | null;
  /** AAAA-MM-DD ou null. */
  validUntil: string | null;
};

/** AAAA-MM-DD para DD/MM/AAAA ("" se não for uma data). */
export function dateBr(iso: string | null | undefined): string {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** O trecho passou da validade? O dia de `valid_until` ainda vale; só o dia seguinte já é "desatualizado". */
export function isStale(validUntil: string | null, now: Date): boolean {
  if (!validUntil) return false;
  return validUntil < now.toISOString().slice(0, 10);
}

const metaStr = (meta: HitView["meta"], k: string): string => (typeof meta?.[k] === "string" ? (meta[k] as string) : "");

/** Um trecho para a IA: título, fonte, data e, se vencido, o aviso. Sem metadados (pacote v0): cabeçalho antigo. */
export function hitText(h: HitView, index: number, now: Date): string {
  const source = metaStr(h.meta, "source");
  const title = metaStr(h.meta, "title");
  if (!h.meta || (!source && !title && !h.validUntil)) return `### Trecho ${index} (${h.source})\n${h.content}`;
  const head = `### Trecho ${index}: ${title || h.source}`;
  const url = metaStr(h.meta, "source_url");
  const date = dateBr(metaStr(h.meta, "source_date"));
  const fonte = `Fonte: ${source || h.source}${url ? ` (${url})` : ""}${date ? ` · data da fonte: ${date}` : ""}`;
  const stale = isStale(h.validUntil, now) ? `\nAviso: pode estar desatualizado (válido até ${dateBr(h.validUntil)}).` : "";
  return `${head}\n${fonte}${stale}\n${h.content}`;
}

/** Resposta do search_knowledge: trechos, instrução de citar a fonte (quando há fonte) e a marca d'água. */
export function hitsText(hits: HitView[], now: Date, watermark: string): string {
  const body = hits.map((h, i) => hitText(h, i + 1, now)).join("\n\n");
  const cited = hits.some((h) => metaStr(h.meta, "source"));
  const stale = hits.some((h) => isStale(h.validUntil, now));
  const notes: string[] = [];
  if (cited) notes.push("Cite a fonte de cada trecho que usar na resposta.");
  if (stale) notes.push("Trechos com aviso de desatualizado: diga ao usuário que a informação pode ter mudado e sugira confirmar na fonte.");
  return `${body}${notes.length ? `\n\n${notes.join(" ")}` : ""}\n\n${watermark}`;
}

/** No teste grátis de pacote v1 só os arquivos com `trial: true` no front-matter; pacote v0 mantém a base inteira. */
export function trialFilesOnly(i: { specVersion?: number; accessIsTrial: boolean }): boolean {
  return i.accessIsTrial && i.specVersion === 1;
}

export const TRIAL_NO_FILES_TEXT =
  "Nada relevante na parte da base liberada no teste grátis. A base completa do especialista vem com a licença.";

// ----- Cota diária -----

/** Janela da cota: as últimas 24 horas (sem a virada de meia-noite como brecha para dobrar o uso). */
export const QUOTA_WINDOW_MS = 24 * 3600 * 1000;

/** Resposta ao passar da cota. É sempre o mesmo texto: a contagem ignora estas respostas (não prolongam o bloqueio). */
export const quotaText = (quota: number): string =>
  `Limite diário atingido: este especialista permite ${quota} consultas à base por dia. Siga com o que já foi consultado e tente de novo amanhã.`;

/** `quota` 0 desliga a cota; `used` é o que a carteira já consultou na janela. */
export const quotaExceeded = (used: number, quota: number): boolean => quota > 0 && used >= quota;

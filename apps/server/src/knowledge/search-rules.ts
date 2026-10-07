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

/** Data AAAA-MM-DD como aparece no texto para a IA ("" se não for uma data). */
export function dateText(iso: string | null | undefined): string {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

const SP_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Hoje (AAAA-MM-DD) no fuso de Brasília: a data de `valid_until` é a de quem escreveu, não a do UTC (às 21h já seria "amanhã"). */
export function todayInSaoPaulo(now: Date): string {
  return SP_DATE.format(now);
}

/** O trecho passou da validade? O dia de `valid_until` ainda vale (no fuso de Brasília); só o dia seguinte já é "desatualizado". */
export function isStale(validUntil: string | null, now: Date): boolean {
  if (!validUntil) return false;
  return validUntil < todayInSaoPaulo(now);
}

const metaStr = (meta: HitView["meta"], k: string): string => (typeof meta?.[k] === "string" ? (meta[k] as string) : "");

/** Um trecho para a IA: título, fonte, data e, se vencido, o aviso. Sem metadados (pacote v0): cabeçalho antigo. */
export function hitText(h: HitView, index: number, now: Date): string {
  const source = metaStr(h.meta, "source");
  const title = metaStr(h.meta, "title");
  if (!h.meta || (!source && !title && !h.validUntil)) return `### Excerpt ${index} (${h.source})\n${h.content}`;
  const head = `### Excerpt ${index}: ${title || h.source}`;
  const url = metaStr(h.meta, "source_url");
  const date = dateText(metaStr(h.meta, "source_date"));
  const fonte = `Source: ${source || h.source}${url ? ` (${url})` : ""}${date ? ` · source date: ${date}` : ""}`;
  const stale = isStale(h.validUntil, now) ? `\nWarning: may be out of date (valid until ${dateText(h.validUntil)}).` : "";
  return `${head}\n${fonte}${stale}\n${h.content}`;
}

/** Resposta do search_knowledge: trechos, instrução de citar a fonte (quando há fonte) e a marca d'água. */
export function hitsText(hits: HitView[], now: Date, watermark: string): string {
  const body = hits.map((h, i) => hitText(h, i + 1, now)).join("\n\n");
  const cited = hits.some((h) => metaStr(h.meta, "source"));
  const stale = hits.some((h) => isStale(h.validUntil, now));
  const notes: string[] = [];
  if (cited) notes.push("Cite the source of each excerpt you use in your answer.");
  if (stale) notes.push("Excerpts with an out-of-date warning: tell the user the information may have changed and suggest confirming it at the source.");
  return `${body}${notes.length ? `\n\n${notes.join(" ")}` : ""}\n\n${watermark}`;
}

/** No teste grátis de pacote v1 só os arquivos com `trial: true` no front-matter; pacote v0 mantém a base inteira. */
export function trialFilesOnly(i: { specVersion?: number; accessIsTrial: boolean }): boolean {
  return i.accessIsTrial && i.specVersion === 1;
}

export const TRIAL_NO_FILES_TEXT =
  "Nothing relevant in the part of the knowledge base unlocked in the free trial. The specialist's full knowledge base comes with the license.";

// ----- Cota diária -----

/** Janela da cota: as últimas 24 horas (sem a virada de meia-noite como brecha para dobrar o uso). */
export const QUOTA_WINDOW_MS = 24 * 3600 * 1000;

/** Resposta ao passar da cota. É sempre o mesmo texto: a contagem ignora estas respostas (não prolongam o bloqueio). */
export const quotaText = (quota: number): string =>
  `Daily limit reached: this specialist allows ${quota} knowledge base searches per day. Continue with what you already looked up and try again tomorrow.`;

/** `quota` 0 desliga a cota; `used` é o que a carteira já consultou na janela. */
export const quotaExceeded = (used: number, quota: number): boolean => quota > 0 && used >= quota;

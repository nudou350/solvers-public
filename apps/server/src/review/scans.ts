import { createHash } from "node:crypto";
import { chunkMarkdown } from "../knowledge/chunk.js";
import { isIsoDate, parseFrontMatter } from "../runtime/validate/frontmatter.js";
import type { PackageInput } from "../runtime/validate/index.js";
import { hiddenCharsAll, injectionMatch, revealHiddenChars, sensitiveAsk, sensitiveQuestion, urlsIn } from "../runtime/validate/text-scans.js";
import { extOf, isTextPath, readText, reviewableEntries } from "./files.js";

// Varreduras automáticas da tela de revisão (PACKAGE_SPEC.md 14.5, item 6). Heurísticas simples que ajudam o revisor
// humano a olhar o lugar certo: NÃO bloqueiam nada e são contornáveis. Puro (sem banco, rede ou disco): quem chama
// monta o PackageInput e, se quiser o teste de duplicados, passa os hashes dos pacotes já publicados.
//
// Os trechos (`snippet`) já saem como texto puro: caracteres invisíveis viram [U+XXXX] visíveis, `<` e `>` viram
// ‹ e › (nenhum HTML sobrevive) e o tamanho é limitado. Mesmo assim a tela deve exibi-los escapados.

export type ScanSeverity = "info" | "warn" | "high";

export type ScanKind =
  | "hidden_unicode" // caractere invisível, de direção ou "tag" Unicode
  | "hidden_html" // HTML/CSS oculto, comentário, script/iframe, link perigoso
  | "remote_image" // imagem remota em Markdown (pode vazar dados ao carregar)
  | "injection" // padrão de injeção de instruções
  | "sensitive_ask" // pede dado sensível (etapas, manifesto, calibragem)
  | "url_list" // lista de URLs do arquivo
  | "url_send" // URL de envio de dados
  | "duplicate_content" // trechos iguais aos de pacote já publicado
  | "search_phrase_off_topic" // searchPhrases sem relação com o conteúdo
  | "expired_knowledge"; // conhecimento com valid_until vencido

export type ScanFinding = { kind: ScanKind; severity: ScanSeverity; path: string; snippet: string; detail: string };

export type ScanCounts = {
  total: number;
  high: number;
  warn: number;
  info: number;
  byKind: Partial<Record<ScanKind, number>>;
  /** Arquivos de texto varridos. */
  files: number;
  knowledgeFiles: number;
  /** Trechos de conhecimento (mesmo corte da ingestão). */
  knowledgeChunks: number;
  /** Trechos de arquivos com `valid_until` anterior a hoje. */
  expiredChunks: number;
  expiredFiles: number;
  /** Trechos iguais (normalizados) a trechos já publicados. */
  duplicateChunks: number;
  /** Achados do mesmo tipo e arquivo que passaram do teto por arquivo e ficaram de fora da lista. */
  suppressed: number;
};

export type ScanReport = { findings: ScanFinding[]; counts: ScanCounts };

export type ScanContext = {
  /** Hashes (`chunkHashes`) dos trechos de conhecimento de pacotes já publicados. */
  publishedChunkHashes?: ReadonlySet<string>;
  /** "Hoje" para `valid_until` (padrão: agora). */
  now?: Date;
};

/** Teto de achados do mesmo tipo no mesmo arquivo (o resto só entra em `counts.suppressed`). */
const PER_KIND_PER_FILE = 10;
const SNIPPET_MAX = 160;
const URL_SNIPPET_MAX = 320;

// ---------------------------------------------------------------------------------------------------------------
// Texto seguro para exibição

/** Trecho curto, em texto puro: invisíveis revelados, sem `<` e `>`, espaços colapsados. */
export function safeSnippet(text: string, max = SNIPPET_MAX): string {
  const s = revealHiddenChars(text).replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›")).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Janela de texto em volta de uma posição, já segura. */
function around(text: string, index: number, length = 0, radius = 50): string {
  return safeSnippet(text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius)));
}

// ---------------------------------------------------------------------------------------------------------------
// Unicode invisível e de direção

const DIRECTION = (cp: number) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
const TAG = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;

function hiddenUnicode(text: string): { severity: ScanSeverity; index: number; snippet: string; detail: string }[] {
  const hits = hiddenCharsAll(text);
  const out: { severity: ScanSeverity; index: number; snippet: string; detail: string }[] = [];
  let i = 0;
  while (i < hits.length) {
    // Agrupa caracteres vizinhos numa sequência só (uma mensagem escondida vira um achado, não 80).
    let j = i;
    let end = hits[i]!.index + (hits[i]!.cp > 0xffff ? 2 : 1);
    while (j + 1 < hits.length && hits[j + 1]!.index === end) {
      j += 1;
      end += hits[j]!.cp > 0xffff ? 2 : 1;
    }
    const run = hits.slice(i, j + 1);
    const first = run[0]!;
    let severity: ScanSeverity = "warn";
    if (run.some((h) => DIRECTION(h.cp) || TAG(h.cp))) severity = "high";
    else if (run.length === 1 && (first.cp === 0x200c || first.cp === 0x200d || (first.cp === 0xfeff && first.index === 0))) severity = "info";
    const tagText = run
      .filter((h) => TAG(h.cp) && h.cp >= 0xe0020 && h.cp <= 0xe007e)
      .map((h) => String.fromCharCode(h.cp - 0xe0000))
      .join("");
    const codes = [...new Set(run.map((h) => h.codePoint))].slice(0, 6).join(", ");
    out.push({
      severity,
      index: first.index,
      snippet: around(text, first.index, end - first.index),
      detail: `${run.length} caractere(s) invisível(is) ou de direção (${codes})${tagText ? `; texto escondido em tags Unicode: "${safeSnippet(tagText, 120)}"` : ""}`,
    });
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// HTML e CSS oculto

const HIDING_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em|rem|%)?\s*(?:;|"|'|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|"|'|$)|(?:left|top|text-indent|margin-left)\s*:\s*-\d{3,}|color\s*:\s*(?:#fff(?:fff)?\b|white\b|transparent\b)|(?:width|height)\s*:\s*0(?:px)?\s*(?:;|"|'|$)/i;
const HIDDEN_ATTR = /\shidden(?:\s|=|\/?>|$)/i;
const DANGEROUS_TAG = /<\s*(script|iframe|object|embed|meta|base|link)\b/gi;
const STYLE_TAG = /<\s*style\b/gi;
const ANY_TAG = /<[a-z][a-z0-9]*\b[^>]{0,500}>/gi;
const MD_COMMENT = /^[ \t]*\[\/\/\]:\s*#\s*[("']/gm;
const BAD_LINK = /(?:\]\(|href\s*=\s*["']?)\s*(?:javascript|vbscript|data)\s*:/gi;
const REMOTE_IMAGE = /!\[[^\]\n]{0,200}\]\(\s*(https?:\/\/[^)\s]+)/gi;

type HtmlHit = { kind: "hidden_html" | "remote_image"; severity: ScanSeverity; index: number; length: number; detail: string };

function hiddenHtml(text: string): HtmlHit[] {
  const out: HtmlHit[] = [];
  // Comentários HTML: o leitor humano não os vê, a IA vê (linear: sem regex que reinicia a busca a cada "<!--").
  for (let from = 0; ; ) {
    const open = text.indexOf("<!--", from);
    if (open === -1) break;
    const close = text.indexOf("-->", open + 4);
    const end = close === -1 ? text.length : close + 3;
    const body = text.slice(open + 4, close === -1 ? text.length : close);
    const bad = injectionMatch(body) !== null;
    out.push({
      kind: "hidden_html",
      severity: bad || close === -1 ? "high" : body.trim() ? "warn" : "info",
      index: open,
      length: Math.min(end - open, 120),
      detail: close === -1 ? "Comentário HTML aberto e nunca fechado (esconde o resto do arquivo)" : bad ? "Comentário HTML com padrão de injeção" : "Comentário HTML (a IA lê, o usuário não vê)",
    });
    if (close === -1) break;
    from = end;
  }
  for (const [re, severity, detail] of [
    [DANGEROUS_TAG, "high", "Tag perigosa em conteúdo que deveria ser texto"],
    [STYLE_TAG, "warn", "Bloco <style> em conteúdo que deveria ser texto"],
    [MD_COMMENT, "warn", "Comentário Markdown oculto ([//]: #)"],
    [BAD_LINK, "high", "Link com javascript:, vbscript: ou data:"],
  ] as const) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) out.push({ kind: "hidden_html", severity, index: m.index, length: m[0].length, detail });
  }
  ANY_TAG.lastIndex = 0;
  for (let m = ANY_TAG.exec(text); m; m = ANY_TAG.exec(text)) {
    if (HIDING_STYLE.test(m[0]) || HIDDEN_ATTR.test(m[0])) out.push({ kind: "hidden_html", severity: "high", index: m.index, length: m[0].length, detail: "Elemento HTML escondido por CSS ou atributo hidden" });
  }
  REMOTE_IMAGE.lastIndex = 0;
  for (let m = REMOTE_IMAGE.exec(text); m; m = REMOTE_IMAGE.exec(text)) {
    out.push({ kind: "remote_image", severity: "warn", index: m.index, length: m[0].length, detail: `Imagem remota (${safeSnippet(m[1]!, 80)}): carregar a imagem pode enviar dados a outro servidor` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Coleta

type Collector = {
  findings: ScanFinding[];
  suppressed: number;
  push: (f: ScanFinding) => void;
};

function collector(): Collector {
  const perKey = new Map<string, number>();
  const c: Collector = {
    findings: [],
    suppressed: 0,
    push(f) {
      const key = `${f.kind}\0${f.path}`;
      const n = perKey.get(key) ?? 0;
      perKey.set(key, n + 1);
      if (n >= PER_KIND_PER_FILE) c.suppressed += 1;
      else c.findings.push(f);
    },
  };
  return c;
}

type TextOpts = {
  /** Frases de injeção (não vale para evals, que a IA não lê). */
  injection: boolean;
  /** Pedidos de dado sensível (etapas e manifesto). */
  sensitive: boolean;
  /** HTML oculto só faz sentido em texto livre, não em strings soltas do manifesto. */
  html: boolean;
};

function scanText(c: Collector, path: string, text: string, o: TextOpts): void {
  for (const h of hiddenUnicode(text)) c.push({ kind: "hidden_unicode", severity: h.severity, path, snippet: h.snippet, detail: h.detail });
  if (o.html) {
    for (const h of hiddenHtml(text)) c.push({ kind: h.kind, severity: h.severity, path, snippet: around(text, h.index, h.length, 10), detail: h.detail });
  }
  if (o.injection) {
    let found = false;
    for (const [i, line] of text.split("\n").entries()) {
      const m = injectionMatch(line);
      if (m) {
        found = true;
        c.push({ kind: "injection", severity: "high", path, snippet: safeSnippet(line), detail: `Padrão de injeção na linha ${i + 1}: "${safeSnippet(m, 80)}"` });
      }
    }
    if (!found) {
      // Frases quebradas em duas linhas só aparecem no texto inteiro.
      const m = injectionMatch(text);
      if (m) c.push({ kind: "injection", severity: "high", path, snippet: safeSnippet(m), detail: "Padrão de injeção que atravessa quebra de linha" });
    }
  }
  if (o.sensitive) {
    const ask = sensitiveAsk(text);
    if (ask) c.push({ kind: "sensitive_ask", severity: "warn", path, snippet: safeSnippet(ask), detail: "Manda pedir dado sensível ao usuário" });
  }
}

/** Uma lista de URLs por arquivo (agrupa as strings do manifesto no próprio manifest.json) + um achado por URL de envio. */
function scanUrls(c: Collector, path: string, texts: string[]): void {
  const urls = new Map<string, boolean>();
  for (const t of texts) {
    for (const u of urlsIn(t)) urls.set(u.url, (urls.get(u.url) ?? false) || u.sending);
  }
  if (urls.size === 0) return;
  const hosts = new Set<string>();
  for (const u of urls.keys()) {
    try {
      hosts.add(new URL(u).hostname.toLowerCase());
    } catch {
      hosts.add("(URL inválida)");
    }
  }
  const insecure = [...urls.keys()].filter((u) => u.toLowerCase().startsWith("http://")).length;
  c.push({
    kind: "url_list",
    severity: "info",
    path,
    snippet: safeSnippet([...urls.keys()].join(" | "), URL_SNIPPET_MAX),
    detail: `${urls.size} URL(s) em ${hosts.size} endereço(s)${insecure ? `, ${insecure} sem https` : ""}: ${safeSnippet([...hosts].join(", "), 200)}`,
  });
  for (const [u, sending] of urls) {
    if (sending) c.push({ kind: "url_send", severity: "warn", path, snippet: safeSnippet(u, URL_SNIPPET_MAX), detail: "URL de envio de dados (verbo de envio na mesma linha ou parâmetros na consulta)" });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conhecimento: trechos, duplicados e vencidos

/** Tamanho (em hex) do hash de trecho guardado/comparado: 128 bits bastam e cabem em colunas e conjuntos pequenos. */
export const CHUNK_HASH_HEX_LEN = 32;
/** Trechos mais curtos que isto (já normalizados) são títulos e frases soltas: não servem como prova de cópia. */
const MIN_CHUNK_CHARS = 80;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const normalizeChunk = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim();

const isKnowledgeText = (p: string) => p.startsWith("knowledge/") && !p.endsWith(".meta.json") && (extOf(p) === ".md" || extOf(p) === ".txt");

/** Corpo do arquivo de conhecimento (sem front-matter, que não vai para a busca) já cortado como na ingestão. */
function knowledgeChunks(path: string, text: string): string[] {
  const body = extOf(path) === ".md" ? parseFrontMatter(text).body : text;
  return chunkMarkdown(body);
}

/** Hash dos trechos de conhecimento normalizados (minúsculas, sem acento nem pontuação), para gravar e comparar entre pacotes. */
export function chunkHashes(input: PackageInput): { path: string; index: number; hash: string }[] {
  const out: { path: string; index: number; hash: string }[] = [];
  for (const e of reviewableEntries(input)) {
    if (!isKnowledgeText(e.path)) continue;
    const text = readText(input, e.path);
    if (text === null) continue;
    for (const [index, chunk] of knowledgeChunks(e.path, text).entries()) {
      const norm = normalizeChunk(chunk);
      if (norm.length < MIN_CHUNK_CHARS) continue;
      out.push({ path: e.path, index, hash: createHash("sha256").update(norm).digest("hex").slice(0, CHUNK_HASH_HEX_LEN) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// searchPhrases fora do assunto

const STOPWORDS = new Set(
  (
    "para como com uma uns umas dos nos nas por que quero preciso precisa gostaria posso pode meu minha seu sua mais sem ser sobre entre quando onde qual quais quanto quantos quanta isso esse essa este esta " +
    "fazer faco faca ajuda ajudar uso usar the and for with from how what make need want help get can you your into"
  ).split(" "),
);

/** Radical grosseiro (tira o "s" final e corta em 5 letras): "receitas" e "receita" viram o mesmo. */
const stemOf = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w).slice(0, 5);

function contentWords(text: string): string[] {
  return (fold(text).match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

function scanSearchPhrases(c: Collector, phrases: string[], corpusTexts: string[]): void {
  if (phrases.length === 0) return;
  const vocab = new Set<string>();
  for (const t of corpusTexts) for (const w of contentWords(t)) vocab.add(stemOf(w));
  for (const [i, phrase] of phrases.entries()) {
    const words = [...new Set(contentWords(phrase))];
    if (words.length === 0) continue;
    const missing = words.filter((w) => !vocab.has(stemOf(w)));
    const coverage = (words.length - missing.length) / words.length;
    if (coverage >= 0.5) continue;
    c.push({
      kind: "search_phrase_off_topic",
      severity: coverage === 0 ? "warn" : "info",
      path: `manifest.json#searchPhrases.${i}`,
      snippet: safeSnippet(phrase),
      detail: `${words.length - missing.length} de ${words.length} palavra(s) aparecem no título, na descrição, nas etapas ou no conhecimento; sem relação: ${safeSnippet(missing.join(", "), 120)}`,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Manifesto

/** Todas as strings do manifesto com o caminho do campo (`manifest.json#steps.0.gate.1`). */
function manifestStrings(raw: unknown): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 12) return;
    if (typeof node === "string") out.push({ path: `manifest.json#${path}`, text: node });
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i), depth + 1));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(raw, "", 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

/** Varre o pacote inteiro. Pura: nada de disco, banco ou rede. */
export function scanPackage(input: PackageInput, ctx: ScanContext = {}): ScanReport {
  const now = ctx.now ?? new Date();
  const c = collector();
  const counts: ScanCounts = { total: 0, high: 0, warn: 0, info: 0, byKind: {}, files: 0, knowledgeFiles: 0, knowledgeChunks: 0, expiredChunks: 0, expiredFiles: 0, duplicateChunks: 0, suppressed: 0 };

  const corpus: string[] = [];
  let phrases: string[] = [];

  for (const e of reviewableEntries(input)) {
    if (!isTextPath(e.path)) continue;
    const text = readText(input, e.path);
    if (text === null) continue;
    counts.files += 1;

    if (e.path === "manifest.json") {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        // JSON quebrado: o validador já reprova; ainda varre o texto cru atrás de caracteres escondidos.
        scanText(c, e.path, text, { injection: true, sensitive: false, html: false });
        continue;
      }
      const strings = manifestStrings(raw);
      for (const s of strings) scanText(c, s.path, s.text, { injection: true, sensitive: true, html: true });
      scanUrls(c, e.path, strings.map((s) => s.text));
      for (const f of sensitiveOnboarding(raw)) c.push(f);
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj?.searchPhrases)) phrases = (obj.searchPhrases as unknown[]).filter((p): p is string => typeof p === "string");
      for (const k of ["name", "tagline", "description"] as const) if (typeof obj?.[k] === "string") corpus.push(obj[k] as string);
      if (Array.isArray(obj?.packageContents)) corpus.push(...(obj.packageContents as unknown[]).filter((p): p is string => typeof p === "string"));
      continue;
    }

    const isStep = e.path.startsWith("steps/");
    const isEval = e.path.startsWith("evals/");
    scanText(c, e.path, text, { injection: !isEval, sensitive: isStep, html: extOf(e.path) !== ".json" || e.path.startsWith("knowledge/") });
    scanUrls(c, e.path, [text]);

    if (isStep || e.path.startsWith("templates/")) corpus.push(text);

    if (isKnowledgeText(e.path)) {
      counts.knowledgeFiles += 1;
      let body = text;
      if (extOf(e.path) === ".md") {
        const fm = parseFrontMatter(text);
        body = fm.body;
        if (fm.kind === "ok") {
          // Título e etiquetas do front-matter também descrevem o assunto.
          for (const k of ["title", "tags"] as const) {
            const v = fm.data[k];
            if (v !== undefined) corpus.push(Array.isArray(v) ? v.join(" ") : v);
          }
          const vu = fm.data.valid_until;
          const expired = typeof vu === "string" && isIsoDate(vu) && new Date(`${vu}T23:59:59Z`) < now;
          if (expired) {
            const n = chunkMarkdown(body).length;
            counts.expiredFiles += 1;
            counts.expiredChunks += n;
            c.push({ kind: "expired_knowledge", severity: "warn", path: e.path, snippet: `valid_until: ${vu}`, detail: `Conteúdo vencido em ${vu}: ${n} trecho(s) ainda entram na busca` });
          }
        }
      }
      corpus.push(body);
      const chunks = chunkMarkdown(body);
      counts.knowledgeChunks += chunks.length;

      const published = ctx.publishedChunkHashes;
      if (published && published.size > 0) {
        let dup = 0;
        let sample = "";
        for (const chunk of chunks) {
          const norm = normalizeChunk(chunk);
          if (norm.length < MIN_CHUNK_CHARS) continue;
          if (published.has(createHash("sha256").update(norm).digest("hex").slice(0, CHUNK_HASH_HEX_LEN))) {
            dup += 1;
            if (!sample) sample = chunk;
          }
        }
        if (dup > 0) {
          counts.duplicateChunks += dup;
          c.push({
            kind: "duplicate_content",
            severity: dup / Math.max(chunks.length, 1) >= 0.5 ? "high" : "warn",
            path: e.path,
            snippet: safeSnippet(sample),
            detail: `${dup} de ${chunks.length} trecho(s) são iguais (normalizados) a conteúdo de pacote já publicado`,
          });
        }
      }
    }
  }

  scanSearchPhrases(c, phrases, corpus);

  const order: Record<ScanSeverity, number> = { high: 0, warn: 1, info: 2 };
  const findings = c.findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of findings) {
    counts.total += 1;
    counts[f.severity] += 1;
    counts.byKind[f.kind] = (counts.byKind[f.kind] ?? 0) + 1;
  }
  counts.suppressed = c.suppressed;
  return { findings, counts };
}

/** Perguntas de calibragem que parecem pedir dado sensível (mesma regra do aviso ONBOARDING_SENSITIVE do validador). */
export function sensitiveOnboarding(manifest: unknown): ScanFinding[] {
  const out: ScanFinding[] = [];
  const questions = (manifest as { onboarding?: { questions?: { ask?: unknown; why?: unknown; options?: unknown }[] } } | null)?.onboarding?.questions;
  if (!Array.isArray(questions)) return out;
  for (const [i, q] of questions.entries()) {
    const text = [q?.ask, q?.why, ...(Array.isArray(q?.options) ? q.options : [])].filter((x): x is string => typeof x === "string").join(" ");
    if (sensitiveQuestion(text)) out.push({ kind: "sensitive_ask", severity: "warn", path: `manifest.json#onboarding.questions.${i}`, snippet: safeSnippet(text), detail: "A pergunta de calibragem parece pedir dado sensível" });
  }
  return out;
}

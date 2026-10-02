import { isIsoDate, parseFrontMatter } from "../runtime/validate/frontmatter.js";
import { chunkMarkdown, chunkPlainText } from "./chunk.js";

// Leitura de UM arquivo de conhecimento (PACKAGE_SPEC.md 6.1 e 6.2): `.md` com front-matter YAML ou `.txt`
// (seção única) com metadados em `nome.txt.meta.json`. Puro (sem env, banco nem disco): testado em
// test/knowledge-ingest.test.ts. Pacotes v0 não têm front-matter e saem exatamente como antes.

/** Metadados guardados em `knowledge_chunks.meta` (só os campos conhecidos; o resto é descartado). */
export type KnowledgeMeta = {
  title?: string;
  source?: string;
  source_url?: string;
  source_date?: string;
  valid_until?: string;
  tags?: string[];
  /** Arquivo liberado no teste grátis de pacotes v1. */
  trial?: boolean;
};

export type ParsedKnowledgeFile = {
  chunks: string[];
  /** null: arquivo sem front-matter (nem .meta.json). */
  meta: KnowledgeMeta | null;
  /** `valid_until` válido (AAAA-MM-DD) ou null. */
  validUntil: string | null;
};

/** `.md` e `.txt` entram no conhecimento; `.txt.meta.json` e o resto não. */
export const isKnowledgeFile = (name: string): boolean => /\.(md|txt)$/i.test(name);

/** Caminho do arquivo de metadados de um `.txt`: `nome.txt.meta.json`. */
export const metaJsonPathFor = (txtPath: string): string => `${txtPath}.meta.json`;

const MAX_TAGS = 10;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Fica só com os campos conhecidos, no tipo certo. Data inválida é descartada (o validador é quem reclama). */
export function normalizeMeta(data: Record<string, unknown>): KnowledgeMeta | null {
  const meta: KnowledgeMeta = {};
  for (const k of ["title", "source", "source_url"] as const) {
    const v = str(data[k]);
    if (v) meta[k] = v;
  }
  for (const k of ["source_date", "valid_until"] as const) {
    const v = str(data[k]);
    if (v && isIsoDate(v)) meta[k] = v;
  }
  if (Array.isArray(data.tags)) {
    const tags = data.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()).slice(0, MAX_TAGS);
    if (tags.length) meta.tags = tags;
  } else if (typeof data.tags === "string" && data.tags.trim()) {
    meta.tags = [data.tags.trim()];
  }
  if (data.trial === true || (typeof data.trial === "string" && data.trial.trim().toLowerCase() === "true")) meta.trial = true;
  return Object.keys(meta).length ? meta : null;
}

/** Título padrão: o primeiro título `#` do texto. */
const firstHeading = (md: string): string | undefined => /^#{1,3}\s+(.+)$/m.exec(md)?.[1]?.trim();

/**
 * Lê um arquivo de conhecimento. `name` define o formato pela extensão; `metaJson` é o conteúdo do
 * `.meta.json` ao lado (só vale para `.txt`).
 */
export function parseKnowledgeFile(name: string, raw: string, metaJson?: string | null): ParsedKnowledgeFile {
  if (/\.txt$/i.test(name)) {
    let meta: KnowledgeMeta | null = null;
    if (metaJson) {
      try {
        const parsed: unknown = JSON.parse(metaJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = normalizeMeta(parsed as Record<string, unknown>);
      } catch {
        // .meta.json quebrado: o arquivo entra sem metadados (o validador recusa antes, na publicação).
      }
    }
    return { chunks: chunkPlainText(raw), meta, validUntil: meta?.valid_until ?? null };
  }
  const fm = parseFrontMatter(raw);
  // Sem front-matter (pacotes v0): o texto original, byte a byte como antes.
  if (fm.kind === "none") return { chunks: chunkMarkdown(raw), meta: null, validUntil: null };
  const meta = fm.kind === "ok" ? normalizeMeta(fm.data) : null;
  if (meta && !meta.title) {
    const heading = firstHeading(fm.body);
    if (heading) meta.title = heading;
  }
  return { chunks: chunkMarkdown(fm.body), meta, validUntil: meta?.valid_until ?? null };
}

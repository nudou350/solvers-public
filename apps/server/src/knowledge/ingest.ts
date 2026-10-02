import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { embed } from "./embeddings.js";
import { isKnowledgeFile, metaJsonPathFor, parseKnowledgeFile } from "./file-rules.js";
import { searchKnowledge } from "./search.js";
import type { SolverPackage } from "../runtime/packages.js";

// Ingestão da base de conhecimento (INSTRUCTIONS.md 5.5 e PACKAGE_SPEC.md 6): `.md` (com front-matter
// opcional) e `.txt` (com `nome.txt.meta.json` opcional) em trechos. O corte está em chunk.ts, puro, e é
// o mesmo usado pelo validador. Pacotes v0 (sem front-matter) continuam gravando exatamente o que gravavam.

type KnowledgeRow = typeof schema.knowledgeChunks.$inferInsert;

type DiscoveredFile = { abs: string; /** `knowledge/<caminho dentro da pasta>`: o que vai em knowledge_chunks.source. */ source: string };

/**
 * Arquivos de conhecimento em ordem estável (a retomada usa a posição). `dir` pode ser a raiz do pacote
 * (com `knowledge/`) ou a própria pasta de conhecimento; o `source` gravado é sempre `knowledge/<relativo>`.
 * Ignora ocultos, node_modules e links simbólicos.
 */
function discover(dir: string, packageRoot = false): DiscoveredFile[] {
  const sub = join(dir, "knowledge");
  const hasSub = existsSync(sub) && lstatSync(sub).isDirectory();
  // Raiz de pacote (tem manifest.json ou foi dita assim) sem knowledge/: não há conhecimento (nunca lê steps/ como base).
  if (!hasSub && (packageRoot || existsSync(join(dir, "manifest.json")))) return [];
  const root = hasSub ? sub : dir;
  if (!existsSync(root)) return [];
  const out: DiscoveredFile[] = [];
  const walk = (cur: string, rel: string[]) => {
    for (const name of readdirSync(cur)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const abs = join(cur, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(abs, [...rel, name]);
      else if (isKnowledgeFile(name)) out.push({ abs, source: ["knowledge", ...rel, name].join("/").split(sep).join("/") });
    }
  };
  walk(root, []);
  return out.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

/** Lê o arquivo, corta em trechos e calcula os vetores (null quando o modelo de embeddings não está disponível). */
async function prepareFile(agentId: string, version: string, f: DiscoveredFile): Promise<KnowledgeRow[]> {
  const raw = readFileSync(f.abs, "utf8");
  const metaPath = metaJsonPathFor(f.abs);
  const metaJson = /\.txt$/i.test(f.abs) && existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
  const parsed = parseKnowledgeFile(f.abs, raw, metaJson);
  const vectors = await embed(parsed.chunks, "passage");
  return parsed.chunks.map((content, i) => ({
    agentId,
    version,
    source: f.source,
    content,
    meta: parsed.meta ? { ...parsed.meta } : null,
    validUntil: parsed.validUntil,
    embedding: vectors?.[i] ?? null,
  }));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insere em lotes (limite de parâmetros do Postgres). */
async function insertRows(tx: Tx, rows: KnowledgeRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) await tx.insert(schema.knowledgeChunks).values(rows.slice(i, i + 200));
}

const versionOf = (agentId: string, version: string) => and(eq(schema.knowledgeChunks.agentId, agentId), eq(schema.knowledgeChunks.version, version));

async function countChunks(agentId: string, version: string, sources?: string[]): Promise<number> {
  if (sources && sources.length === 0) return 0;
  const [r] = await db
    .select({ n: count() })
    .from(schema.knowledgeChunks)
    .where(and(versionOf(agentId, version), sources ? inArray(schema.knowledgeChunks.source, sources) : undefined));
  return Number(r?.n ?? 0);
}

export type IngestKnowledgeOpts = {
  agentId: string;
  /** Versão do pacote; pode ser `staging:<id>` (ingestão de teste da revisão). */
  version: string;
  dir: string;
  /** Quantos arquivos (na ordem estável) já foram ingeridos: a retomada pula esses. */
  resumeFromFile?: number;
  /** Chamado ao fim de cada arquivo: arquivos prontos, total e trechos gravados até agora. */
  onFile?: (done: number, total: number, chunks: number) => void | Promise<void>;
};

/**
 * Ingere uma pasta de conhecimento na versão informada, arquivo a arquivo. Idempotente por arquivo: cada um
 * apaga os próprios trechos antes de regravá-los (retomar ou repetir não duplica). No fim, trechos de
 * arquivos que não estão mais na pasta saem da versão. Devolve o total de arquivos e de trechos da versão.
 */
export async function ingestKnowledgeDir(opts: IngestKnowledgeOpts): Promise<{ files: number; chunks: number }> {
  const { agentId, version } = opts;
  const files = discover(opts.dir);
  const start = Math.min(Math.max(0, Math.trunc(opts.resumeFromFile ?? 0)), files.length);
  let chunks = await countChunks(agentId, version, files.slice(0, start).map((f) => f.source));
  for (const [i, f] of files.entries()) {
    if (i < start) continue;
    const rows = await prepareFile(agentId, version, f);
    await db.transaction(async (tx) => {
      await tx.delete(schema.knowledgeChunks).where(and(versionOf(agentId, version), eq(schema.knowledgeChunks.source, f.source)));
      await insertRows(tx, rows);
    });
    chunks += rows.length;
    await opts.onFile?.(i + 1, files.length, chunks);
  }
  // Arquivo que saiu da pasta não pode continuar sendo servido.
  const sources = files.map((f) => f.source);
  await db.delete(schema.knowledgeChunks).where(and(versionOf(agentId, version), sources.length ? notInArray(schema.knowledgeChunks.source, sources) : undefined));
  return { files: files.length, chunks: await countChunks(agentId, version) };
}

/**
 * Publicação de pacote (cli:publish e seed): troca a versão inteira numa só transação, então quem busca
 * nunca vê a base pela metade. Devolve o número de trechos.
 */
export async function ingestPackage(pkg: SolverPackage): Promise<number> {
  const { id, version } = pkg.manifest;
  const rows: KnowledgeRow[] = [];
  for (const f of discover(pkg.dir, true)) rows.push(...(await prepareFile(id, version, f)));
  await db.transaction(async (tx) => {
    await tx.delete(schema.knowledgeChunks).where(versionOf(id, version));
    await insertRows(tx, rows);
  });
  return rows.length;
}

/**
 * Aprovação da revisão: os trechos da versão de teste passam a ser os da versão real, SEM recalcular
 * vetores. Se `to` já tinha trechos (republicação da mesma versão), eles saem na mesma transação.
 * Devolve quantos trechos mudaram de versão (0: `from` estava vazia e nada foi tocado).
 */
export async function renameKnowledgeVersion(agentId: string, from: string, to: string): Promise<number> {
  if (from === to) return 0;
  return db.transaction(async (tx) => {
    const [has] = await tx.select({ n: count() }).from(schema.knowledgeChunks).where(versionOf(agentId, from));
    if (!Number(has?.n ?? 0)) return 0;
    await tx.delete(schema.knowledgeChunks).where(versionOf(agentId, to));
    const moved = await tx.update(schema.knowledgeChunks).set({ version: to }).where(versionOf(agentId, from)).returning({ id: schema.knowledgeChunks.id });
    return moved.length;
  });
}

/** Apaga todos os trechos de uma versão (staging descartado, versão antiga). Devolve quantos. */
export async function deleteKnowledgeVersion(agentId: string, version: string): Promise<number> {
  const gone = await db.delete(schema.knowledgeChunks).where(versionOf(agentId, version)).returning({ id: schema.knowledgeChunks.id });
  return gone.length;
}

/** Busca do revisor numa versão de teste (`staging:<id>`): o mesmo ranking da busca real, sem cota nem teste grátis. */
export async function searchKnowledgeInVersion(agentId: string, version: string, query: string, k = 5): Promise<{ source: string; content: string; score: number }[]> {
  const hits = await searchKnowledge(agentId, version, query, k);
  return hits.map((h) => ({ source: h.source, content: h.content, score: h.score }));
}

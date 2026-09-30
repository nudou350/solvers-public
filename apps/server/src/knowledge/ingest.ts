import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { embed } from "./embeddings.js";
import type { SolverPackage } from "../runtime/packages.js";

// Ingestão da base de conhecimento (INSTRUCTIONS.md 5.5): agents/<slug>/knowledge/**/*.md em
// trechos de ~500 tokens (~2000 caracteres) com sobreposição de ~50 tokens (~200 caracteres).

const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 200;

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? mdFiles(full) : name.endsWith(".md") ? [full] : [];
  });
}

/** Quebra primeiro por seções (##), depois por parágrafos, mantendo o título da seção em cada trecho. */
export function chunkMarkdown(md: string): string[] {
  const sections = md.split(/\n(?=#{1,3} )/g).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const section of sections) {
    if (section.length <= CHUNK_CHARS) {
      out.push(section);
      continue;
    }
    const heading = /^#{1,3} .+$/m.exec(section)?.[0] ?? "";
    const paras = section.split(/\n{2,}/);
    let cur = "";
    for (const p of paras) {
      if (cur && cur.length + p.length + 2 > CHUNK_CHARS) {
        out.push(cur.trim());
        const tail = cur.slice(-OVERLAP_CHARS);
        cur = `${heading && !tail.startsWith(heading) ? `${heading}\n\n` : ""}…${tail}\n\n${p}`;
      } else {
        cur = cur ? `${cur}\n\n${p}` : p;
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export async function ingestPackage(pkg: SolverPackage): Promise<number> {
  const { id, version } = pkg.manifest;
  const kdir = join(pkg.dir, "knowledge");
  const chunks: { source: string; content: string }[] = [];
  for (const file of mdFiles(kdir)) {
    const source = relative(pkg.dir, file).split(sep).join("/");
    for (const content of chunkMarkdown(readFileSync(file, "utf8"))) chunks.push({ source, content });
  }
  const vectors = await embed(
    chunks.map((c) => c.content),
    "passage",
  );
  await db.transaction(async (tx) => {
    await tx.delete(schema.knowledgeChunks).where(and(eq(schema.knowledgeChunks.agentId, id), eq(schema.knowledgeChunks.version, version)));
    for (const [i, c] of chunks.entries()) {
      const v = vectors?.[i];
      await tx.insert(schema.knowledgeChunks).values({
        agentId: id,
        version,
        source: c.source,
        content: c.content,
        embedding: v ?? null,
      });
    }
  });
  return chunks.length;
}

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { chunkMarkdown } from "./chunk.js";
import { embed } from "./embeddings.js";
import type { SolverPackage } from "../runtime/packages.js";

// Ingestão da base de conhecimento (INSTRUCTIONS.md 5.5): agents/<slug>/knowledge/**/*.md em
// trechos (o corte está em chunk.ts, puro, e é o mesmo usado pelo validador).

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? mdFiles(full) : name.endsWith(".md") ? [full] : [];
  });
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

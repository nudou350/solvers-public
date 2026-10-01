// Galeria de imagens dos especialistas e moderação das fotos de avaliação (feito pelo admin: o criador não troca
// imagem sem revisão; quem revisa o pacote revisa as capturas e as sobe aqui).
//
//   pnpm --filter @solvers/server cli:images list <slug>                      galeria + fotos de avaliação, com ids e URLs
//   pnpm --filter @solvers/server cli:images add <slug> <arquivo...>          acrescenta à galeria (máx. 5, na ordem dos arquivos)
//   pnpm --filter @solvers/server cli:images remove <slug> <id>               remove uma imagem da galeria
//   pnpm --filter @solvers/server cli:images remove-review <id>               remove uma foto de avaliação (moderação)
//
// A primeira imagem é a capa. Use `.env.devnet` com `cli:images:devnet`.

import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { MAX_AGENT_IMAGES } from "@solvers/shared";
import { db, pool, schema } from "../db/index.js";
import { ImageError, processImage } from "../images/process.js";
import { imageStore, type ImageStore } from "../images/store.js";
import { findAgentRow } from "../store/catalog.js";
import { firstFreePosition } from "../store/image-rules.js";

const USAGE = "uso: cli:images list <slug> | add <slug> <arquivo...> | remove <slug> <id> | remove-review <id>";

function store(): ImageStore {
  const s = imageStore();
  if (!s) throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET não estão definidos no .env");
  return s;
}

async function list(slug: string) {
  const s = store();
  const agent = await findAgentRow(slug);
  const rows = await db.select().from(schema.agentImages).where(eq(schema.agentImages.agentId, agent.id)).orderBy(asc(schema.agentImages.position));
  console.log(`Galeria de ${agent.slug} (${rows.length}/${MAX_AGENT_IMAGES})`);
  for (const r of rows) console.log(`  #${r.position + 1}  ${r.id}  ${r.width}x${r.height}  ${s.url(r.key, "full")}`);
  const reviews = await db.select().from(schema.reviews).where(eq(schema.reviews.agentId, agent.id));
  for (const rv of reviews) {
    const imgs = await db.select().from(schema.reviewImages).where(eq(schema.reviewImages.reviewId, rv.id)).orderBy(asc(schema.reviewImages.position));
    for (const r of imgs) console.log(`  avaliação de ${rv.authorWallet.slice(0, 6)}…  ${r.id}  ${s.url(r.key, "full")}`);
  }
}

async function add(slug: string, files: string[]) {
  if (files.length === 0) throw new Error(USAGE);
  const s = store();
  const agent = await findAgentRow(slug);
  for (const file of files) {
    const used = (await db.select({ position: schema.agentImages.position }).from(schema.agentImages).where(eq(schema.agentImages.agentId, agent.id))).map((r) => r.position);
    const position = firstFreePosition(used, MAX_AGENT_IMAGES);
    if (position === null) throw new Error(`A galeria já tem ${MAX_AGENT_IMAGES} imagens; remova uma antes (cli:images remove).`);
    const img = await processImage(await readFile(file));
    const key = `solvers/agents/${agent.id}/${randomBytes(12).toString("hex")}`;
    await s.put(key, img.data);
    try {
      await db.insert(schema.agentImages).values({ id: randomBytes(8).toString("hex"), agentId: agent.id, position, key, width: img.width, height: img.height });
    } catch (e) {
      await s.delete(key).catch(() => {});
      throw e;
    }
    console.log(`  #${position + 1}  ${file}  ->  ${s.url(key, "full")}`);
  }
}

async function remove(slug: string, id: string) {
  const s = store();
  const agent = await findAgentRow(slug);
  const rows = await db.select().from(schema.agentImages).where(eq(schema.agentImages.agentId, agent.id));
  const img = rows.find((r) => r.id === id);
  if (!img) throw new Error(`imagem ${id} não está na galeria de ${agent.slug} (veja cli:images list)`);
  await db.delete(schema.agentImages).where(eq(schema.agentImages.id, id));
  await s.delete(img.key);
  console.log(`removida ${id}`);
}

async function removeReview(id: string) {
  const s = store();
  const [img] = await db.delete(schema.reviewImages).where(eq(schema.reviewImages.id, id)).returning();
  if (!img) throw new Error(`foto de avaliação ${id} não encontrada`);
  await s.delete(img.key);
  console.log(`removida ${id}`);
}

async function main() {
  const [cmd, a, ...rest] = process.argv.slice(2);
  if (cmd === "list" && a) return list(a);
  if (cmd === "add" && a) return add(a, rest);
  if (cmd === "remove" && a && rest[0]) return remove(a, rest[0]);
  if (cmd === "remove-review" && a) return removeReview(a);
  throw new Error(USAGE);
}

main()
  .catch((e) => {
    console.error(e instanceof ImageError ? `imagem recusada: ${e.message}` : (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

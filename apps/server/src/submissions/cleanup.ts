import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { canTransition } from "@solvers/shared";
import { db, schema } from "../db/index.js";
import { deleteKnowledgeVersion } from "../knowledge/ingest.js";
import { EXPIRABLE_STATUSES, EXPIRED_NOTE, filesExpired, orphanFolderStale, partFileStale, REJECTED_FILES_TTL_DAYS, STALE_OPEN_TTL_DAYS, SYSTEM_REVIEWER } from "./cleanup-rules.js";
import { creatorMessage, notifyCreatorWallet } from "./notify.js";
import { stagingVersion, submissionDir, submissionsRoot, SUBMISSION_ID_RE } from "./paths.js";

// Faxina das submissões (job em jobs.ts, a cada 6 h). Idempotente; cada passo falha sozinho sem derrubar os outros:
//  1. expira `changes_requested` e `awaiting_creator_signature` paradas há mais de 30 dias (vira `rejected`, nota "expirada",
//     linha `expire` em package_reviews assinada por "system"; o slug fica livre e o conhecimento de teste sai);
//  2. apaga o ZIP e a pasta extraída de submissões rejeitadas há mais de 30 dias;
//  3. apaga pastas em SUBMISSIONS_DIR sem linha no banco (mais de 1 dia) e `.part` de upload cortado (mais de 1 dia).

const dayAgo = (days: number) => sql`now() - make_interval(days => ${days})`;

/** Passo 1. Devolve quantas submissões expiraram. */
export async function expireStaleSubmissions(opts: { notify?: boolean; limit?: number } = {}): Promise<number> {
  const s = schema.packageSubmissions;
  const rows = await db
    .select({ id: s.id, agentId: s.agentId, wallet: s.creatorWallet, slug: s.slug, version: s.version })
    .from(s)
    .where(and(inArray(s.status, [...EXPIRABLE_STATUSES]), lt(s.updatedAt, dayAgo(STALE_OPEN_TTL_DAYS))))
    .limit(opts.limit ?? 50);
  let n = 0;
  for (const r of rows) {
    const expired = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from package_submissions where id = ${r.id} for update`);
      const [fresh] = await tx.select({ status: s.status, approved: s.approved, updatedAt: s.updatedAt }).from(s).where(eq(s.id, r.id));
      // Reconferido sob trava: o criador pode ter reenviado ou assinado enquanto o job rodava.
      if (!fresh || !(EXPIRABLE_STATUSES as readonly string[]).includes(fresh.status)) return false;
      if (!canTransition(fresh.status as never, "rejected")) return false;
      const moved = await tx
        .update(s)
        .set({ status: "rejected", reviewerNotes: EXPIRED_NOTE, updatedAt: new Date() })
        .where(and(eq(s.id, r.id), eq(s.status, fresh.status), lt(s.updatedAt, dayAgo(STALE_OPEN_TTL_DAYS))))
        .returning({ id: s.id });
      if (moved.length === 0) return false;
      // A versão aprovada que nunca foi assinada não segura mais o preço/hash: sai de `agent_published_versions`.
      if (fresh.approved?.version) {
        await tx.delete(schema.agentPublishedVersions).where(and(eq(schema.agentPublishedVersions.agentId, r.agentId), eq(schema.agentPublishedVersions.version, fresh.approved.version), isNull(schema.agentPublishedVersions.approveTx)));
      }
      await tx.insert(schema.packageReviews).values({ submissionId: r.id, reviewerWallet: SYSTEM_REVIEWER, action: "expire", notes: EXPIRED_NOTE, checklist: {}, versionHash: fresh.approved?.versionHash ?? null });
      return true;
    });
    if (!expired) continue;
    n += 1;
    await deleteKnowledgeVersion(r.agentId, stagingVersion(r.id)).catch((e) => console.warn("[cleanup] staging não removido:", (e as Error).message));
    await rm(submissionDir(r.id), { recursive: true, force: true }).catch(() => undefined);
    if (opts.notify !== false) await notifyCreatorWallet(r.wallet, creatorMessage("rejected", { id: r.id, slug: r.slug, version: r.version, creatorWallet: r.wallet, name: null }, EXPIRED_NOTE)).catch(() => undefined);
  }
  return n;
}

/** Passo 2. Devolve quantas pastas foram apagadas. */
export async function removeRejectedFiles(limit = 200): Promise<number> {
  const s = schema.packageSubmissions;
  const rows = await db
    .select({ id: s.id, status: s.status, updatedAt: s.updatedAt })
    .from(s)
    .where(and(inArray(s.status, ["rejected_validation", "rejected"]), lt(s.updatedAt, dayAgo(REJECTED_FILES_TTL_DAYS))))
    .limit(limit);
  let n = 0;
  for (const r of rows) {
    if (!filesExpired(r.status, r.updatedAt)) continue;
    const dir = submissionDir(r.id);
    if (!existsSync(dir)) continue;
    await rm(dir, { recursive: true, force: true });
    n += 1;
  }
  return n;
}

/** Passo 3. Devolve quantas pastas/arquivos foram apagados. */
export async function removeOrphans(): Promise<number> {
  const root = submissionsRoot();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0; // pasta ainda não existe
  }
  const ids = names.filter((n) => SUBMISSION_ID_RE.test(n));
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db.select({ id: schema.packageSubmissions.id }).from(schema.packageSubmissions).where(inArray(schema.packageSubmissions.id, chunk));
    for (const r of rows) known.add(r.id);
  }
  let n = 0;
  for (const id of ids) {
    const dir = join(root, id);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      if (orphanFolderStale(known.has(id), st.mtimeMs)) {
        await rm(dir, { recursive: true, force: true });
        n += 1;
        continue;
      }
      for (const f of await readdir(dir)) {
        if (!f.endsWith(".part")) continue;
        const fst = await stat(join(dir, f));
        if (partFileStale(f, fst.mtimeMs)) {
          await rm(join(dir, f), { force: true });
          n += 1;
        }
      }
    } catch (e) {
      console.warn(`[cleanup] ${id}:`, (e as Error).message);
    }
  }
  return n;
}

/** O job: os três passos, cada um isolado. Devolve o total de ações. */
export async function cleanupSubmissionsOnce(): Promise<number> {
  let total = 0;
  for (const [name, step] of [
    ["expirar paradas", () => expireStaleSubmissions()],
    ["arquivos rejeitados", () => removeRejectedFiles()],
    ["órfãos e .part", () => removeOrphans()],
  ] as const) {
    try {
      total += await step();
    } catch (e) {
      console.error(`[jobs] faxina de submissões (${name}):`, (e as Error).message);
    }
  }
  return total;
}

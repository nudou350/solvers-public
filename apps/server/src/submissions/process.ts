import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { canTransition, type SubmissionStatus } from "@solvers/shared";
import { db, pool, schema } from "../db/index.js";
import { env } from "../env.js";
import { deleteKnowledgeVersion, ingestKnowledgeDir } from "../knowledge/ingest.js";
import { chunkHashes, scanPackage } from "../review/scans.js";
import { diffPackages } from "../review/diff.js";
import { validatePackage, type Issue, type ValidationResult } from "../runtime/validate/index.js";
import { packageFromFolder } from "../runtime/validate/input.js";
import { reloadPackages } from "../runtime/packages.js";
import { RESERVED_SLUGS } from "@solvers/shared";
import { duplicateVersion, loadOwnership, currentPackages, minPriceUnits, PLATFORM_OWNER, type Ownership } from "./lookup.js";
import { adminMessage, creatorMessage, notifyAdmin, notifyCreatorWallet } from "./notify.js";
import { extractedDirOf, stagingVersion, submissionDir, zipPathOf } from "./paths.js";
import { mergeWarnings, normalizeManifest, reportFromZip, safeManifestFields } from "./rules.js";
import { extractZip, NUCLEO_ZIP_LIMITS, ZipError, type ZipLimits } from "./zip.js";

// Processamento de uma submissão no worker (PACKAGE_SPEC.md 13, 14.2 e 16):
//   submitted -> validating -> (rejected_validation | pending_review)
// Etapas: extrair o ZIP, validar (terceiros), normalizar `id`/`creator.id` no manifesto, varrer, comparar com a versão
// publicada, ingerir o conhecimento em staging (`staging:<id>`) e liberar para a revisão. O estado de cada etapa fica no
// banco: depois de um reinício o que já passou (validação e varreduras em `scans`) não se repete e a ingestão retoma do
// último arquivo concluído (`ingest_jobs.files_done`).

type Row = typeof schema.packageSubmissions.$inferSelect;

export type ProcessDeps = {
  ingest: typeof ingestKnowledgeDir;
  deleteStaging: typeof deleteKnowledgeVersion;
  notifyAdmin: (text: string) => Promise<void>;
  notifyCreator: (wallet: string, text: string) => Promise<void>;
  minPriceUnits: () => Promise<bigint>;
  limits: () => ZipLimits;
  /** Teto de tempo de uma passada (padrão `SUBMISSION_TIMEOUT_MS`); os testes encurtam. */
  timeoutMs?: number;
};

export const defaultProcessDeps: ProcessDeps = {
  ingest: ingestKnowledgeDir,
  deleteStaging: deleteKnowledgeVersion,
  notifyAdmin,
  notifyCreator: notifyCreatorWallet,
  minPriceUnits,
  limits: () => ({ ...NUCLEO_ZIP_LIMITS, zipBytes: env.SUBMISSION_MAX_ZIP_BYTES, expandedBytes: env.SUBMISSION_MAX_UNZIPPED_BYTES, files: env.SUBMISSION_MAX_FILES }),
};

// ---------------------------------------------------------------------------------------------------------------
// Trava: uma submissão só é processada por um worker por vez (e sobrevive a reinício: a trava morre com a conexão)

/** O worker recebeu SIGTERM: a ingestão para depois do arquivo em curso (checkpoint gravado) e retoma no próximo início. */
export class WorkerStopping extends Error {
  constructor() {
    super("worker encerrando");
    this.name = "WorkerStopping";
  }
}
let stopping = false;
export const requestStop = (): void => {
  stopping = true;
};

async function acquireLock(id: string): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as ok", [`submission:${id}`]);
    if (!rows[0]?.ok) {
      client.release();
      return null;
    }
  } catch (e) {
    client.release();
    throw e;
  }
  return async () => {
    try {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`submission:${id}`]);
    } finally {
      client.release();
    }
  };
}

/** Tentativas do worker por submissão (cada `claim` conta uma): passado o teto, rejeita com erro genérico em vez de repetir para sempre. */
export const MAX_ATTEMPTS = 3;
/** Teto de tempo de uma passada por submissão (checado entre as etapas e a cada arquivo ingerido). */
export const SUBMISSION_TIMEOUT_MS = 15 * 60_000;
/** Texto que o criador vê quando o sistema (não o pacote) falhou: o detalhe vai só para o log. */
export const SYSTEM_FAILURE_MESSAGE = "We couldn't process this submission because of an internal error. Resubmit the package; if the error repeats, contact the team.";

/** A passada passou do tempo permitido (conta como falha de sistema). */
export class SubmissionTimeout extends Error {
  constructor() {
    super("tempo limite do processamento da submissão");
    this.name = "SubmissionTimeout";
  }
}

/** Regra pura: o worker ainda pode tentar esta submissão? (`attempts` já inclui a passada atual.) */
export const attemptsExhausted = (attempts: number, max = MAX_ATTEMPTS): boolean => attempts >= max;

/**
 * Marca a submissão como `validating` (de `submitted`) com `FOR UPDATE SKIP LOCKED` e conta a tentativa; devolve a linha,
 * null se não é para processar, ou `{ exhausted }` quando já estourou as tentativas (o worker caiu ou falhou N vezes nela).
 */
async function claim(id: string): Promise<Row | null | { exhausted: Row }> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`select id from package_submissions where id = ${id} for update skip locked`);
    if (locked.rows.length === 0) return null;
    const [row] = await tx.select().from(schema.packageSubmissions).where(eq(schema.packageSubmissions.id, id));
    if (!row) return null;
    if (row.status !== "submitted" && row.status !== "validating") return null;
    if (row.status === "submitted" && !canTransition("submitted", "validating")) return null;
    if (row.attempts >= MAX_ATTEMPTS) {
      // As tentativas anteriores não terminaram (falha ou queda do processo): para aqui, sem laço eterno.
      await tx
        .update(schema.packageSubmissions)
        .set({ status: "validating", updatedAt: new Date() })
        .where(and(eq(schema.packageSubmissions.id, id), eq(schema.packageSubmissions.status, "submitted")));
      return { exhausted: row };
    }
    const [upd] = await tx
      .update(schema.packageSubmissions)
      .set({ status: "validating", attempts: sql`${schema.packageSubmissions.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(schema.packageSubmissions.id, id), inArray(schema.packageSubmissions.status, ["submitted", "validating"])))
      .returning();
    return upd ?? null;
  });
}

/** Devolve a tentativa (o worker parou de propósito: deploy ou SIGTERM não é falha da submissão). */
async function refundAttempt(id: string): Promise<void> {
  await db
    .update(schema.packageSubmissions)
    .set({ attempts: sql`greatest(${schema.packageSubmissions.attempts} - 1, 0)` })
    .where(eq(schema.packageSubmissions.id, id));
}

/** Rejeita por falha de sistema repetida: erro genérico ao criador, detalhe só no log. Devolve true se passou a `rejected_validation`. */
async function rejectExhausted(row: Row, deps: ProcessDeps): Promise<boolean> {
  const validation = reportFromZip([{ code: "PROCESSING_FAILED", path: "", message: SYSTEM_FAILURE_MESSAGE, fix: "Resubmit the package." }]);
  const moved = await setStatus(row.id, "validating", "rejected_validation", { error: SYSTEM_FAILURE_MESSAGE, validation });
  if (!moved) return false;
  await rm(extractedDirOf(row.id), { recursive: true, force: true }).catch(() => undefined);
  await deps.deleteStaging(row.agentId, stagingVersion(row.id)).catch(() => undefined);
  const subject = { id: row.id, slug: row.slug, version: row.version, creatorWallet: row.creatorWallet, name: null };
  await deps.notifyAdmin(adminMessage("rejected_validation", subject, `Falhas de sistema repetidas (${MAX_ATTEMPTS} tentativas); veja o log do worker.`)).catch(() => undefined);
  await deps.notifyCreator(row.creatorWallet, creatorMessage("rejected_validation", subject)).catch(() => undefined);
  return true;
}

const setStatus = async (id: string, from: SubmissionStatus, to: SubmissionStatus, set: Partial<Row> = {}): Promise<boolean> => {
  if (!canTransition(from, to)) throw new Error(`transição inválida ${from} -> ${to}`);
  const r = await db
    .update(schema.packageSubmissions)
    .set({ ...set, status: to, updatedAt: new Date() })
    .where(and(eq(schema.packageSubmissions.id, id), eq(schema.packageSubmissions.status, from)))
    .returning({ id: schema.packageSubmissions.id });
  return r.length > 0;
};

// ---------------------------------------------------------------------------------------------------------------

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const toIssue = (i: Issue) => ({ code: i.code, path: i.path, message: i.message, fix: i.fix });
const asReport = (r: ValidationResult, zipWarnings: Parameters<typeof mergeWarnings>[1]) => ({
  ok: r.ok,
  errors: r.errors.map(toIssue),
  warnings: mergeWarnings(r.warnings.map(toIssue), zipWarnings),
  stats: r.stats as unknown as Record<string, unknown>,
});

/**
 * Processa uma submissão (`submitted` ou `validating`). Devolve o estado em que ficou, ou "skipped" se não era para
 * processar (outro worker com ela, estado já avançado). Idempotente e retomável.
 */
export async function processSubmission(id: string, deps: ProcessDeps = defaultProcessDeps): Promise<SubmissionStatus | "skipped"> {
  const unlock = await acquireLock(id);
  if (!unlock) return "skipped";
  try {
    const row = await claim(id);
    if (!row) return "skipped";
    if ("exhausted" in row) {
      console.error(`[worker] submissão ${id} passou de ${MAX_ATTEMPTS} tentativas: rejeitada por falha de sistema`);
      return (await rejectExhausted(row.exhausted, deps)) ? "rejected_validation" : "skipped";
    }
    const deadline = Date.now() + (deps.timeoutMs ?? SUBMISSION_TIMEOUT_MS);
    try {
      return await run(row, deps, deadline);
    } catch (e) {
      if (e instanceof WorkerStopping) {
        await refundAttempt(id).catch(() => undefined);
        throw e;
      }
      console.error(`[worker] falha de sistema em ${id} (tentativa ${row.attempts}/${MAX_ATTEMPTS}):`, e);
      // Última tentativa: não espera a próxima passada, rejeita já com erro genérico.
      if (attemptsExhausted(row.attempts) && (await rejectExhausted(row, deps))) return "rejected_validation";
      throw e;
    }
  } finally {
    await unlock();
  }
}

const checkDeadline = (deadline: number): void => {
  if (Date.now() > deadline) throw new SubmissionTimeout();
};

async function run(row: Row, deps: ProcessDeps, deadline: number): Promise<SubmissionStatus> {
  const id = row.id;
  const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, row.creatorWallet));
  if (!creator) {
    await setStatus(id, "validating", "rejected_validation", { error: "Creator profile not found.", validation: reportFromZip([{ code: "CREATOR_NOT_FOUND", path: "", message: "Creator profile not found.", fix: "Complete your creator profile." }]) });
    return "rejected_validation";
  }
  const subject = (r: Row) => ({ id, slug: r.slug, version: r.version, creatorWallet: r.creatorWallet, name: (r.manifest?.name as string | undefined) ?? null });
  const dir = extractedDirOf(id);

  // Retoma só o que falta: validação e varreduras já gravadas + pasta extraída intacta.
  const validated = (row.validation as { ok?: boolean } | null)?.ok === true;
  const resume = validated && row.scans !== null && row.manifest !== null && existsSync(join(dir, "manifest.json"));
  let current = row;

  if (!resume) {
    // Recomeço limpo (primeiro processamento, reenvio ou pasta perdida): nada do envio anterior pode sobrar.
    await rm(dir, { recursive: true, force: true });
    await db.delete(schema.ingestJobs).where(eq(schema.ingestJobs.submissionId, id));
    await deps.deleteStaging(row.agentId, stagingVersion(id));
    reloadPackages();

    const outcome = await validateStage(row, creator, dir, deps);
    checkDeadline(deadline);
    if (!outcome.ok) {
      await setStatus(id, "validating", "rejected_validation", { validation: outcome.validation, manifest: outcome.manifest, slug: outcome.slug, version: outcome.version, agentId: outcome.agentId, error: null });
      const after = { ...row, slug: outcome.slug, version: outcome.version, manifest: outcome.manifest };
      await deps.notifyAdmin(adminMessage("rejected_validation", subject(after), `${outcome.validation.errors.length} erro(s).`));
      await deps.notifyCreator(row.creatorWallet, creatorMessage("rejected_validation", subject(after)));
      return "rejected_validation";
    }
    // Validação e varreduras num único UPDATE: é o ponto de retomada.
    await db
      .update(schema.packageSubmissions)
      .set({ manifest: outcome.manifest, validation: outcome.validation, scans: outcome.scans, slug: outcome.slug, version: outcome.version, agentId: outcome.agentId, error: null, updatedAt: new Date() })
      .where(eq(schema.packageSubmissions.id, id));
    current = { ...row, manifest: outcome.manifest, slug: outcome.slug, version: outcome.version, agentId: outcome.agentId };
  }

  await ingestStage(current, dir, deps, deadline);

  const moved = await setStatus(id, "validating", "pending_review", { error: null });
  if (moved) {
    const counts = (current.scans as { report?: { counts?: { high?: number; warn?: number } } } | null)?.report?.counts;
    const extra = `Avisos do validador: ${(current.validation as { warnings?: unknown[] } | null)?.warnings?.length ?? 0}. Varreduras: ${counts?.high ?? 0} alta(s), ${counts?.warn ?? 0} média(s).`;
    await deps.notifyAdmin(adminMessage("pending_review", subject(current), extra));
    await deps.notifyCreator(current.creatorWallet, creatorMessage("pending_review", subject(current)));
  }
  return "pending_review";
}

type Stage =
  | { ok: false; validation: ReturnType<typeof reportFromZip>; manifest: Record<string, unknown> | null; slug: string; version: string; agentId: string }
  | { ok: true; validation: ReturnType<typeof asReport>; scans: Record<string, unknown>; manifest: Record<string, unknown>; slug: string; version: string; agentId: string };

/** Extrai, valida, normaliza o manifesto e varre. Nunca grava no banco: devolve o resultado para `run`. */
async function validateStage(row: Row, creator: typeof schema.creators.$inferSelect, dir: string, deps: ProcessDeps): Promise<Stage> {
  const keep = { slug: row.slug, version: row.version, agentId: row.agentId };
  let extracted;
  try {
    extracted = await extractZip(zipPathOf(row.id), dir, deps.limits());
  } catch (e) {
    if (e instanceof ZipError) return { ok: false, validation: reportFromZip(e.issues), manifest: null, ...keep };
    // ZIP sumiu do disco ou erro de sistema: reprovar com um motivo claro (o criador reenvia).
    console.error(`[worker] falha ao ler o ZIP de ${row.id}:`, e);
    return { ok: false, validation: reportFromZip([{ code: "ZIP_UNREADABLE", path: "", message: "We couldn't read the uploaded ZIP.", fix: "Upload the package again." }]), manifest: null, ...keep };
  }

  const input = packageFromFolder(extracted.root);
  let text: string;
  try {
    text = await readFile(join(extracted.root, "manifest.json"), "utf8");
  } catch {
    // Sem `manifest.json` com este nome exato: erro de validação (não de sistema), senão a submissão repetiria para sempre.
    await rm(extracted.root, { recursive: true, force: true });
    return { ok: false, validation: reportFromZip([{ code: "ZIP_BAD_ROOT", path: "manifest.json", message: "manifest.json is missing from the package root folder (exact name, lowercase).", fix: "Put manifest.json directly in the package root folder." }]), manifest: null, ...keep };
  }
  const raw = parseJson(text);
  const rawObj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const fields = safeManifestFields(raw);
  const manifestId = typeof rawObj?.id === "string" && /^[0-9a-f]{32}$/.test(rawObj.id) ? rawObj.id : undefined;

  const own: Ownership = await loadOwnership({ submissionId: row.id, creatorId: creator.id, manifestId, slug: fields.slug });
  const minUnits = await deps.minPriceUnits();
  const result = validatePackage(input, {
    origin: "third_party",
    phase: "nucleo",
    creatorId: creator.id,
    minPriceUsdc: Number(minUnits) / 1_000_000,
    reservedSlugs: RESERVED_SLUGS,
    existing: {
      creatorId: creator.id,
      ownerOfId: (i) => own.idOwner.get(i),
      ownerOfSlug: (s) => own.slugOwner.get(s),
    },
    previous: own.published ? { version: own.published.version, manifest: own.published.manifest } : undefined,
    limits: { zipBytes: env.SUBMISSION_MAX_ZIP_BYTES, expandedBytes: env.SUBMISSION_MAX_UNZIPPED_BYTES, files: env.SUBMISSION_MAX_FILES },
    archive: { zipBytes: extracted.zipBytes, expandedBytes: extracted.expandedBytes, roots: 1 },
  });
  const validation = asReport(result, extracted.warnings);

  // Id do Solver: o do criador para esse slug; senão o `id` do manifesto (se for dele ou de ninguém); senão o do envio.
  let agentId = own.ownAgentId ?? (manifestId && (own.idOwner.get(manifestId) === undefined || own.idOwner.get(manifestId) === creator.id) ? manifestId : row.agentId);
  if (manifestId && own.ownAgentId && manifestId !== own.ownAgentId) {
    validation.errors.push({ code: "MANIFEST_ID_OWNER", path: "manifest.json#id", message: "The manifest id is not the id of the Solver that uses this slug.", fix: "Use your Solver's id or remove the id field." });
  }
  if (own.idOwner.get(agentId) === PLATFORM_OWNER) agentId = row.agentId;
  if (fields.version && (await duplicateVersion({ submissionId: row.id, wallet: row.creatorWallet, agentId, version: fields.version }))) {
    validation.errors.push({ code: "MANIFEST_VERSION_NOT_GREATER", path: "manifest.json#version", message: `You already have another submission of version ${fields.version} of this Solver.`, fix: "Resubmit through the submission that requested changes, or bump the version." });
  }
  validation.ok = validation.errors.length === 0;

  const base = { slug: fields.slug ?? "", version: fields.version ?? "", agentId };
  if (!validation.ok) {
    await rm(extracted.root, { recursive: true, force: true });
    // Só campos seguros e curtos (nome, slug, versão): o JSON cru (até 10 MB) não vai para a coluna jsonb das listas.
    return { ok: false, validation, manifest: rawObj ? { ...fields } : null, ...base };
  }

  // O servidor é a autoridade do `id` e do `creator.id`: grava no manifesto ANTES de varrer e de calcular o hash.
  const manifest = normalizeManifest(rawObj!, { agentId, creatorId: creator.id });
  await writeFile(join(extracted.root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const next = packageFromFolder(extracted.root);

  const publishedHashes = new Set<string>();
  const prevPackage = own.published?.dir && existsSync(join(own.published.dir, "manifest.json")) ? packageFromFolder(own.published.dir) : null;
  for (const pkg of currentPackages()) {
    if (pkg.manifest.id === agentId) continue;
    try {
      for (const h of chunkHashes(packageFromFolder(pkg.dir))) publishedHashes.add(h.hash);
    } catch (e) {
      console.warn(`[worker] não consegui ler os trechos de ${pkg.manifest.slug} para a varredura de duplicados:`, (e as Error).message);
    }
  }
  const report = scanPackage(next, { publishedChunkHashes: publishedHashes });
  const diff = diffPackages(prevPackage, next);
  return {
    ok: true,
    validation,
    scans: { report, diff, generatedAt: new Date().toISOString() },
    manifest,
    slug: base.slug,
    version: base.version,
    agentId,
  };
}

/** Ingestão do conhecimento em staging, com checkpoint por arquivo em `ingest_jobs`. */
async function ingestStage(row: Row, dir: string, deps: ProcessDeps, deadline: number): Promise<void> {
  const id = row.id;
  await db.insert(schema.ingestJobs).values({ submissionId: id, status: "queued" }).onConflictDoNothing();
  const [job] = await db.select().from(schema.ingestJobs).where(eq(schema.ingestJobs.submissionId, id));
  if (!job || job.status === "done") return;
  await db
    .update(schema.ingestJobs)
    .set({ status: "running", error: null, startedAt: job.startedAt ?? new Date() })
    .where(eq(schema.ingestJobs.submissionId, id));
  try {
    const out = await deps.ingest({
      agentId: row.agentId,
      version: stagingVersion(id),
      dir,
      resumeFromFile: job.filesDone,
      onFile: async (done, total, chunks) => {
        await db.update(schema.ingestJobs).set({ filesDone: done, filesTotal: total, chunksDone: chunks }).where(eq(schema.ingestJobs.submissionId, id));
        if (stopping) throw new WorkerStopping();
        checkDeadline(deadline);
      },
    });
    await db
      .update(schema.ingestJobs)
      .set({ status: "done", filesTotal: out.files, filesDone: out.files, chunksDone: out.chunks, finishedAt: new Date(), error: null })
      .where(eq(schema.ingestJobs.submissionId, id));
  } catch (e) {
    if (e instanceof WorkerStopping) {
      await db.update(schema.ingestJobs).set({ status: "queued" }).where(eq(schema.ingestJobs.submissionId, id));
      throw e;
    }
    // O detalhe (modelo de embeddings, banco, disco) fica no log e em ingest_jobs; o criador vê só um texto fixo.
    const message = (e as Error).message.slice(0, 500);
    console.error(`[worker] ingestão de ${id} falhou:`, message);
    await db.update(schema.ingestJobs).set({ status: "failed", error: message }).where(eq(schema.ingestJobs.submissionId, id));
    await db.update(schema.packageSubmissions).set({ error: "Knowledge ingestion failed; the system will try again shortly.", updatedAt: new Date() }).where(eq(schema.packageSubmissions.id, id));
    throw e;
  }
}

/** Apaga o ZIP e a pasta extraída de uma submissão (rejeitadas há muito tempo). */
export async function removeSubmissionFiles(id: string): Promise<void> {
  await rm(submissionDir(id), { recursive: true, force: true });
}

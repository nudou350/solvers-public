import { pathToFileURL } from "node:url";
import { and, asc, inArray, notInArray } from "drizzle-orm";
import { db, pool, schema } from "../db/index.js";
import { warmEmbeddings } from "../knowledge/embeddings.js";
import { notifyAdmin } from "../submissions/notify.js";
import { MAX_ATTEMPTS, processSubmission, requestStop, WorkerStopping } from "../submissions/process.js";

// Processo PM2 próprio (solvers-worker; PACKAGE_SPEC.md 16): extrai o ZIP, valida, varre e ingere o conhecimento em staging,
// uma submissão por vez, com checkpoint em ingest_jobs. Fica fora do solvers-api para não competir com o MCP e os pagamentos.
// Entrada compilada: dist/worker/index.js (infra/worker-run.sh).
//
// Retomada: o deploy do CI reinicia o processo a cada push. `validating` conta como pendente: o que já foi validado não se
// repete e a ingestão recomeça do último arquivo concluído. Uma submissão que falha por erro de sistema (banco, disco,
// modelo de embeddings) volta a ser tentada depois de um intervalo, sem travar as outras.

const POLL_MS = 3000;
const RETRY_AFTER_MS = 60_000;

const sleep = (ms: number, stopped: () => boolean) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    const tick = setInterval(() => {
      if (stopped()) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 250);
    t.unref();
    setTimeout(() => clearInterval(tick), ms + 300).unref();
  });

/** Ids pendentes, os mais antigos primeiro, sem os de `skip` (as que estão em backoff não ocupam as vagas da fila). */
export async function pendingSubmissionIds(limit = 20, skip: readonly string[] = []): Promise<string[]> {
  const where = skip.length
    ? and(inArray(schema.packageSubmissions.status, ["submitted", "validating"]), notInArray(schema.packageSubmissions.id, [...skip]))
    : inArray(schema.packageSubmissions.status, ["submitted", "validating"]);
  const rows = await db.select({ id: schema.packageSubmissions.id }).from(schema.packageSubmissions).where(where).orderBy(asc(schema.packageSubmissions.createdAt)).limit(limit);
  return rows.map((r) => r.id);
}

/** Uma passada: processa cada pendente (fora do backoff). Devolve quantos foram processados. */
export async function workOnce(failedAt: Map<string, number> = new Map(), now: () => number = Date.now): Promise<number> {
  let done = 0;
  const inBackoff = [...failedAt].filter(([, at]) => now() - at < RETRY_AFTER_MS).map(([id]) => id);
  for (const id of await pendingSubmissionIds(20, inBackoff)) {
    const failed = failedAt.get(id);
    if (failed !== undefined && now() - failed < RETRY_AFTER_MS) continue;
    try {
      const out = await processSubmission(id);
      if (out !== "skipped") done += 1;
      failedAt.delete(id);
    } catch (e) {
      if (e instanceof WorkerStopping) return done;
      console.error(`[worker] falha ao processar ${id}:`, e);
      // Avisa o admin só na primeira falha (as seguintes só entram no log).
      if (failedAt.get(id) === undefined) await notifyAdmin(`Solvers: o worker falhou ao processar a submissão ${id}: ${(e as Error).message.slice(0, 300)}. Vai tentar de novo em 1 minuto (no máximo ${MAX_ATTEMPTS} tentativas).`);
      failedAt.set(id, now());
    }
  }
  return done;
}

export async function runWorker(stopped: () => boolean = () => false): Promise<void> {
  const failedAt = new Map<string, number>();
  console.log("[worker] ouvindo submissões");
  while (!stopped()) {
    let did = 0;
    try {
      did = await workOnce(failedAt);
    } catch (e) {
      console.error("[worker] erro no laço:", e);
    }
    if (did === 0) await sleep(POLL_MS, stopped);
  }
}

async function main() {
  let stop = false;
  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal}: termina o arquivo em curso e encerra`);
    stop = true;
    requestStop();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  warmEmbeddings();
  await runWorker(() => stop);
  await pool.end().catch(() => undefined);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[worker] falha fatal", e);
    process.exit(1);
  });
}

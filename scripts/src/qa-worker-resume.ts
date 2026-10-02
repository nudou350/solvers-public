// QA do worker (PACKAGE_SPEC.md 16): mata o worker NO MEIO da ingestão e prova que, ao voltar, ele retoma do último arquivo
// concluído (ingest_jobs.files_done) sem duplicar trechos. Pré-requisitos: servidor SEM inline + worker rodando (processo
// separado) contra o banco do QA, e o criador do QA já convidado (rode o estágio 1 do e2e-creator antes).
//
//   cd apps/server && SUBMISSIONS_INLINE=false node --env-file=.env.qa --import tsx src/index.ts        # terminal 1
//   cd apps/server && SUBMISSIONS_INLINE=false node --env-file=.env.qa --import tsx src/worker/index.ts # terminal 2
//   cd scripts && ONLY_STAGES=1 npx tsx --env-file=../apps/server/.env.qa src/e2e-creator.ts           # convida o criador (uma vez)
//   cd scripts && npx tsx --env-file=../apps/server/.env.qa src/qa-worker-resume.ts
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadSigner } from "@solvers/chain";

process.env.API_URL ??= "http://localhost:3027";
const API = process.env.API_URL;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("API_URL precisa ser local");
const { login } = await import("./e2e-api.js");
const { qaPackageFiles, zipOfFiles } = await import("./lib/qa-package.js");

const SERVER_DIR = join(import.meta.dirname, "..", "..", "apps", "server");
const PG = process.env.PG_CONTAINER ?? "solvers-pg-criador";
const sql = <T = any>(q: string): T[] => JSON.parse(execFileSync("docker", ["exec", PG, "psql", "-U", "postgres", "-d", process.env.PG_DB ?? "t_qa", "-tA", "-c", `select coalesce(json_agg(t),'[]'::json) from (${q}) t`], { encoding: "utf8" }).trim());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function workerPids(): number[] {
  if (process.platform === "win32") {
    const out = spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*src/worker/index.ts*' } | ForEach-Object { $_.ProcessId }"], { encoding: "utf8" }).stdout;
    return out.split(/\s+/).filter(Boolean).map(Number);
  }
  return spawnSync("pgrep", ["-f", "src/worker/index.ts"], { encoding: "utf8" }).stdout.split(/\s+/).filter(Boolean).map(Number);
}

const creator = await loadSigner(join(SERVER_DIR, ".qa-data", "keys", "qa-creator.json"));
const token = await login(creator);

// Pacote com muitos arquivos de conhecimento (cada um com 2 seções = 2 trechos) para a ingestão durar alguns segundos.
const N = Number(process.env.FILES ?? 400);
const files = qaPackageFiles({ slug: "qa-retomada-worker" });
for (let i = 0; i < N; i++) {
  files[`knowledge/lote/arquivo-${String(i).padStart(4, "0")}.md`] = `---\ntitle: Nota ${i} do lote de teste\nsource: Portal do Empreendedor\nsource_date: 2026-01-15\nvalid_until: 2026-12-31\ntags: [lote]\n---\n\n# Nota ${i}\n\n## Primeira parte ${i}\n\nTexto único ${i}-${Math.random().toString(36).slice(2)} sobre o assunto ${i * 7919} do lote de teste do worker.\n\n## Segunda parte ${i}\n\nOutro texto ${i}-${Math.random().toString(36).slice(2)} com a explicação ${i * 104729} do lote de teste.\n`;
}
const manifest = JSON.parse(files["manifest.json"]!);
manifest.packageContents = [...manifest.packageContents, "Lote grande de notas de conhecimento (teste do worker)"];
files["manifest.json"] = JSON.stringify(manifest, null, 2);

const up = await fetch(`${API}/api/creator/submissions`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/zip" }, body: zipOfFiles(files, "qa-retomada-worker") as unknown as BodyInit });
const upJson = (await up.json()) as { id?: string; status?: string; error?: string };
if (up.status !== 202 || !upJson.id) throw new Error(`upload falhou: ${up.status} ${JSON.stringify(upJson)}`);
const id = upJson.id;
console.log(`envio ${id} (${N} arquivos de conhecimento)`);

// Espera a ingestão começar e algum progresso, e mata o worker.
let killedAt = -1;
const t0 = Date.now();
while (Date.now() - t0 < 120_000) {
  const j = sql<{ status: string; files_done: number; files_total: number }>(`select status, files_done, files_total from ingest_jobs where submission_id = '${id}'`)[0];
  if (j && j.status === "running" && j.files_done >= 20 && j.files_done < j.files_total) {
    for (const pid of workerPids()) process.kill(pid, "SIGKILL");
    killedAt = j.files_done;
    console.log(`worker morto com ${j.files_done}/${j.files_total} arquivos ingeridos`);
    break;
  }
  if (j && j.status === "done") break;
  await sleep(150);
}
if (killedAt < 0) throw new Error("não consegui pegar a ingestão no meio (aumente FILES)");
await sleep(1500);
const mid = sql<{ status: string; files_done: number }>(`select (select status from package_submissions where id='${id}') sub_status, status, files_done from ingest_jobs where submission_id = '${id}'`)[0];
console.log("estado depois da morte:", JSON.stringify(mid));

// Sobe o worker de novo e espera terminar.
spawn("node", ["--env-file=.env.qa", "--import", "tsx", "src/worker/index.ts"], { cwd: SERVER_DIR, detached: true, stdio: "ignore", env: { ...process.env, SUBMISSIONS_INLINE: "false" } }).unref();
let final: any;
const t1 = Date.now();
while (Date.now() - t1 < 240_000) {
  final = sql(`select s.status, s.attempts, j.status ingest, j.files_done, j.files_total, j.chunks_done, (select count(*)::int from knowledge_chunks k where k.agent_id = s.agent_id) chunks, (select count(*)::int from (select source, content from knowledge_chunks k where k.agent_id = s.agent_id group by source, content having count(*) > 1) d) duplicados, s.validation->'stats'->>'knowledgeChunksEstimate' estimado from package_submissions s join ingest_jobs j on j.submission_id = s.id where s.id = '${id}'`)[0];
  if (final?.status === "pending_review" || final?.status === "rejected_validation") break;
  await sleep(1000);
}
console.log("final:", JSON.stringify(final));
const ok = final?.status === "pending_review" && final.ingest === "done" && final.files_done === final.files_total && final.duplicados === 0 && final.chunks === final.chunks_done;
console.log(ok ? "RETOMADA OK: terminou do checkpoint, sem trechos duplicados" : "RETOMADA FALHOU");
process.exitCode = ok ? 0 : 1;

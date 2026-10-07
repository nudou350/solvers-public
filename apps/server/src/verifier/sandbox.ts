import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { env } from "../env.js";
import { badRequest } from "../lib/http.js";
import { randomId } from "../lib/crypto.js";
import { evaluateReport, PREVIEW_TEST_FILE, type Files, type RunResult } from "./report.js";
import { describeReadFailure, dirUsage, readRegularFile, readRegularJson } from "./safe-read.js";

// Verificador da garantia (INSTRUCTIONS.md 5.7): roda a entrega contra a bateria de aceite
// combinada na criação da garantia, num container descartável (sem rede, CPU/memória limitadas,
// sem privilégios, rootfs somente leitura, timeout que mata o container). Um teste por vez (fila).
// Também captura uma prévia em HTML estático do componente (sem código-fonte).
// Tudo que volta do container (relatório e prévia) é NÃO CONFIÁVEL: lido só via safe-read.ts.

export type { Files, RunResult, TestReport } from "./report.js";

const ALLOWED_EXT = /\.(tsx?|jsx?|css|json|md)$/;
const RESERVED = /^(acceptance\.|__preview__)/;
const MAX_TOTAL_BYTES = 300_000;
const MAX_FILES = 40;
const MAX_OUTPUT = 200_000;
const TIMEOUT_MS = 60_000;
/** Tetos dos arquivos que voltam do container e do que ele pode gravar no relatório. */
const MAX_JSON_BYTES = 2_000_000;
const MAX_PREVIEW_BYTES = 400_000;
const MAX_REPORT_DIR_BYTES = 8_000_000;
const MAX_REPORT_DIR_ENTRIES = 500;
const WATCH_MS = 1_000;

function normalizeName(name: string): string {
  const norm = posix.normalize(name.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (norm.startsWith("..") || norm.includes("/../") || !ALLOWED_EXT.test(norm)) throw badRequest(`File not allowed: ${name}`);
  return norm;
}

/** Valida nomes (sem ../, sem caminho absoluto, sem nomes reservados) e tamanho da entrega. */
export function sanitizeFiles(files: Files): Files {
  const entries = Object.entries(files);
  if (entries.length === 0) throw badRequest("Delivery has no files");
  if (entries.length > MAX_FILES) throw badRequest(`At most ${MAX_FILES} files per delivery`);
  let total = 0;
  const out: Files = {};
  for (const [name, content] of entries) {
    const norm = normalizeName(name);
    if (RESERVED.test(posix.basename(norm))) throw badRequest(`Name reserved for the acceptance test suite: ${name}`);
    total += Buffer.byteLength(content);
    out[norm] = content;
  }
  if (total > MAX_TOTAL_BYTES) throw badRequest("Delivery too large (max. 300 KB)");
  return out;
}

/** Bateria de aceite: só arquivos de teste, gravados como acceptance.<nome> na raiz do src. */
export function sanitizeAcceptance(files: Files): Files {
  const out: Files = {};
  for (const [name, content] of Object.entries(files)) {
    const norm = normalizeName(name);
    if (!/\.test\.(tsx?|jsx?)$/.test(norm) || norm.includes("/")) throw badRequest(`Invalid acceptance test: ${name} (use Name.test.tsx)`);
    out[`acceptance.${norm}`] = content;
  }
  if (Object.keys(out).length === 0) throw badRequest("Acceptance test suite is empty");
  return out;
}

export function writeFiles(dir: string, files: Files) {
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Componente principal da entrega (primeiro .tsx/.jsx que não é teste e exporta algo). */
export function entryComponent(files: Files): string | null {
  const entry = Object.entries(files).find(
    ([n, c]) => /\.(tsx|jsx)$/.test(n) && !/\.test\./.test(n) && /export\s+(default\s+)?(function|const)\s+[A-Z]/.test(c),
  );
  return entry ? entry[0] : null;
}

/**
 * Teste auxiliar que renderiza o componente e grava o HTML estático para a prévia. Nunca reprova:
 * o servidor exige código de saída 0 do vitest, e a prévia é opcional (componente que precisa de
 * outras props, ou que falha ao importar, só fica sem prévia).
 */
function previewTest(entry: string): string {
  const mod = `./${entry.replace(/\.(tsx|jsx)$/, "")}`;
  return `import { render } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
it("__preview__", async () => {
  try {
    const all = (await import(${JSON.stringify(mod)})) as Record<string, unknown>;
    const C = (all.default ?? Object.values(all).find((v) => typeof v === "function" && /^[A-Z]/.test((v as { name: string }).name))) as never;
    if (!C) return;
    const { container } = render(<C {...({ onSubmit: () => {} } as object)} />);
    writeFileSync("/work/report/preview.html", container.innerHTML);
  } catch {
    // sem prévia
  }
});
`;
}

let queue: Promise<unknown> = Promise.resolve();

/** Enfileira para rodar um teste por vez (VPS pequena). */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function docker(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const append = (d: Buffer) => {
      if (out.length < MAX_OUTPUT) out += d.toString().slice(0, MAX_OUTPUT - out.length);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("close", (code) => res({ code: code ?? 1, out }));
    child.on("error", (e) => res({ code: 127, out: String(e) }));
  });
}

/** Remove scripts, handlers e URLs javascript: do HTML capturado (a prévia não executa nada). */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "")
    .slice(0, 200_000);
}

function simulate(files: Files, acceptance: Files | null): RunResult {
  const tests = Object.keys({ ...files, ...(acceptance ?? {}) }).filter((n) => /\.test\.(tsx?|jsx?)$/.test(n));
  const all = { ...files, ...(acceptance ?? {}) };
  const count = tests.reduce((acc, t) => acc + (all[t]!.match(/\b(it|test)\(/g)?.length ?? 0), 0);
  const accCount = acceptance ? Object.values(acceptance).reduce((a, c) => a + (c.match(/\b(it|test)\(/g)?.length ?? 0), 0) : 0;
  const passed = count > 0 && entryComponent(files) != null;
  return {
    report: {
      passed,
      mode: "simulated",
      numTests: count,
      numPassed: passed ? count : 0,
      numFailed: passed ? 0 : 1,
      acceptance: acceptance ? { numTests: accCount, numPassed: passed ? accCount : 0 } : null,
      failures: passed ? [] : [{ test: "structure", message: "The delivery needs a component and tests (*.test.tsx)." }],
      durationMs: 0,
    },
    previewHtml: null,
  };
}

/** Apaga a pasta da execução. O container pode ter deixado pastas sem permissão: limpa por dentro dele. */
async function cleanup(base: string, report: string, image: string) {
  try {
    rmSync(base, { recursive: true, force: true });
    return;
  } catch {
    /* segue para a limpeza pelo container */
  }
  try {
    await docker([
      "run", "--rm", "--network", "none", "--cap-drop", "ALL", "--user", "node",
      "-v", `${report}:/work/report`, image,
      "sh", "-c", "rm -rf /work/report/* /work/report/.[!.]* 2>/dev/null; true",
    ]);
    rmSync(base, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[verifier] não consegui apagar ${base}:`, (e as Error).message);
  }
}

export async function runTests(rawFiles: Files, opts: { acceptance?: Files | null; image?: string } = {}): Promise<RunResult> {
  const files = sanitizeFiles(rawFiles);
  const acceptance = opts.acceptance ?? null;
  if (env.VERIFIER_MODE === "simulated") return simulate(files, acceptance);
  const image = opts.image ?? env.VERIFIER_IMAGE;
  return enqueue(async () => {
    const id = randomId(8);
    const base = resolve(env.DELIVERABLES_DIR, "runs", id);
    const src = join(base, "src");
    const report = join(base, "report");
    const name = `solvers-verify-${id}`;
    const t0 = Date.now();
    let timedOut = false;
    let overflow = false;
    let timer: NodeJS.Timeout | undefined;
    let watch: NodeJS.Timeout | undefined;
    const kill = () => void docker(["kill", name]);
    // Tudo que cria a pasta da execução fica dentro do try: qualquer erro aqui também apaga runs/<id>.
    try {
      mkdirSync(report, { recursive: true });
      // O container roda como "node" (uid 1000), que não é o dono da pasta (o usuário do servidor):
      // sem isto o vitest não consegue gravar o relatório. A pasta é só desta execução e é apagada no fim.
      // O que o container deixa aqui é NÃO CONFIÁVEL (symlink, FIFO, arquivo enorme): ver safe-read.ts.
      chmodSync(report, 0o777);
      writeFiles(src, { ...files, ...(acceptance ?? {}) });
      const entry = entryComponent(files);
      if (entry) writeFiles(src, { [PREVIEW_TEST_FILE]: previewTest(entry) });
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, TIMEOUT_MS);
      // Vigia do tamanho do relatório: o container grava direto numa pasta do host.
      watch = setInterval(() => {
        const u = dirUsage(report, MAX_REPORT_DIR_ENTRIES);
        if (!overflow && (u.truncated || u.bytes > MAX_REPORT_DIR_BYTES)) {
          overflow = true;
          kill();
        }
      }, WATCH_MS);
      const r = await docker([
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--cpus",
        "1",
        "--memory",
        "768m",
        "--pids-limit",
        "256",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        // Rootfs somente leitura: o código da entrega não adultera o vitest nem o node_modules.
        // Só /tmp (tmpfs com teto; o cacheDir do vitest aponta para lá) e /work/report são graváveis.
        "--read-only",
        "--tmpfs",
        "/tmp:rw,size=64m",
        // O vite grava o config empacotado aqui (node_modules/.vite-temp); com rootfs read-only precisa de tmpfs.
        "--tmpfs",
        "/work/node_modules/.vite-temp:rw,size=16m",
        "--env",
        "HOME=/tmp",
        // Nenhum arquivo criado passa de 8 MB (o vigia acima cobre o total da pasta).
        "--ulimit",
        "fsize=8000000:8000000",
        "--user",
        "node",
        "-v",
        `${src}:/work/src:ro`,
        "-v",
        `${report}:/work/report`,
        image,
        "npx",
        "--no-install",
        "vitest",
        "run",
        "--reporter=json",
        "--outputFile.json=/work/report/vitest.json",
      ]);
      clearInterval(watch);
      const read = readRegularJson(join(report, "vitest.json"), MAX_JSON_BYTES);
      const testReport = evaluateReport({
        json: read.ok ? read.value : null,
        jsonProblem: read.ok ? undefined : describeReadFailure("The test report", read),
        exitCode: r.code,
        timedOut,
        overflow,
        out: r.out,
        acceptanceFiles: acceptance ? Object.keys(acceptance) : null,
        durationMs: Date.now() - t0,
      });
      let previewHtml: string | null = null;
      if (testReport.passed) {
        const p = readRegularFile(join(report, "preview.html"), MAX_PREVIEW_BYTES);
        if (p.ok) previewHtml = sanitizeHtml(p.data.toString("utf8"));
      }
      return { report: testReport, previewHtml };
    } finally {
      clearTimeout(timer);
      clearInterval(watch);
      await cleanup(base, report, image);
    }
  });
}

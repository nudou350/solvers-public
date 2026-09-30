import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, posix } from "node:path";
import { env } from "../env.js";
import { badRequest } from "../lib/http.js";
import { randomId } from "../lib/crypto.js";

// Verificador da garantia (INSTRUCTIONS.md 5.7): roda os testes da entrega num container
// descartável, sem rede, com limite de CPU/memória e timeout. Um teste por vez (fila).

export type Files = Record<string, string>;

export type TestReport = {
  passed: boolean;
  mode: "docker" | "simulated";
  numTests: number;
  numPassed: number;
  numFailed: number;
  failures: { test: string; message: string }[];
  durationMs: number;
  log?: string;
};

const ALLOWED_EXT = /\.(tsx?|jsx?|css|json|md)$/;
const MAX_TOTAL_BYTES = 300_000;
const MAX_FILES = 40;

/** Valida nomes (sem ../, sem caminho absoluto) e tamanho da entrega. */
export function sanitizeFiles(files: Files): Files {
  const entries = Object.entries(files);
  if (entries.length === 0) throw badRequest("Entrega sem arquivos");
  if (entries.length > MAX_FILES) throw badRequest(`No máximo ${MAX_FILES} arquivos por entrega`);
  let total = 0;
  const out: Files = {};
  for (const [name, content] of entries) {
    const norm = posix.normalize(name.replace(/\\/g, "/")).replace(/^\/+/, "");
    if (norm.startsWith("..") || norm.includes("/../") || !ALLOWED_EXT.test(norm)) {
      throw badRequest(`Arquivo não permitido: ${name}`);
    }
    total += Buffer.byteLength(content);
    out[norm] = content;
  }
  if (total > MAX_TOTAL_BYTES) throw badRequest("Entrega grande demais (máx. 300 KB)");
  return out;
}

export function writeFiles(dir: string, files: Files) {
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Enfileira para rodar um teste por vez (VPS pequena). */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function runDocker(srcDir: string, image: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const args = [
      "run",
      "--rm",
      "--network",
      "none",
      "--cpus",
      "1",
      "--memory",
      "768m",
      "--pids-limit",
      "256",
      "-v",
      `${srcDir}:/work/src:ro`,
      image,
      "npx",
      "vitest",
      "run",
      "--reporter=json",
    ];
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      res({ code: 127, stdout, stderr: String(e) });
    });
  });
}

type VitestJson = {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  testResults?: { assertionResults?: { fullName?: string; title?: string; status?: string; failureMessages?: string[] }[] }[];
};

function parseVitest(stdout: string): VitestJson | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as VitestJson;
  } catch {
    return null;
  }
}

/**
 * Modo simulado (desenvolvimento sem Docker): só confere a estrutura da entrega.
 * O relatório deixa claro que não houve execução real.
 */
function simulate(files: Files): TestReport {
  const names = Object.keys(files);
  const tests = names.filter((n) => /\.test\.(tsx?|jsx?)$/.test(n));
  const count = tests.reduce((acc, t) => acc + (files[t]!.match(/\b(it|test)\(/g)?.length ?? 0), 0);
  const passed = tests.length > 0 && count > 0;
  return {
    passed,
    mode: "simulated",
    numTests: count,
    numPassed: passed ? count : 0,
    numFailed: passed ? 0 : 1,
    failures: passed ? [] : [{ test: "estrutura", message: "A entrega precisa incluir arquivos *.test.tsx com testes." }],
    durationMs: 0,
  };
}

export async function runTests(rawFiles: Files, image = env.VERIFIER_IMAGE): Promise<TestReport> {
  const files = sanitizeFiles(rawFiles);
  if (env.VERIFIER_MODE === "simulated") return simulate(files);
  return enqueue(async () => {
    const dir = resolve(env.DELIVERABLES_DIR, "runs", randomId(8));
    writeFiles(dir, files);
    const t0 = Date.now();
    try {
      const r = await runDocker(dir, image);
      const json = parseVitest(r.stdout);
      const failures =
        json?.testResults?.flatMap((tr) =>
          (tr.assertionResults ?? [])
            .filter((a) => a.status === "failed")
            .map((a) => ({ test: a.fullName ?? a.title ?? "teste", message: (a.failureMessages ?? []).join("\n").slice(0, 800) })),
        ) ?? [];
      const numTests = json?.numTotalTests ?? 0;
      const numPassed = json?.numPassedTests ?? 0;
      return {
        passed: r.code === 0 && numTests > 0 && numPassed === numTests,
        mode: "docker",
        numTests,
        numPassed,
        numFailed: json?.numFailedTests ?? (r.code === 0 ? 0 : 1),
        failures: failures.length || r.code === 0 ? failures : [{ test: "execução", message: (r.stderr || r.stdout).slice(-1500) }],
        durationMs: Date.now() - t0,
        log: json ? undefined : (r.stderr || r.stdout).slice(-2000),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

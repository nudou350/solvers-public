import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { env } from "../env.js";
import { badRequest } from "../lib/http.js";
import { randomId } from "../lib/crypto.js";

// Verificador da garantia (INSTRUCTIONS.md 5.7): roda a entrega contra a bateria de aceite
// combinada na criação da garantia, num container descartável (sem rede, CPU/memória limitadas,
// sem privilégios, timeout que mata o container). Um teste por vez (fila).
// Também captura uma prévia em HTML estático do componente (sem código-fonte).

export type Files = Record<string, string>;

export type TestReport = {
  passed: boolean;
  mode: "docker" | "simulated";
  numTests: number;
  numPassed: number;
  numFailed: number;
  /** Testes da bateria de aceite (fixa) versus testes que vieram na entrega. */
  acceptance: { numTests: number; numPassed: number } | null;
  failures: { test: string; message: string }[];
  durationMs: number;
  log?: string;
};

export type RunResult = { report: TestReport; previewHtml: string | null };

const ALLOWED_EXT = /\.(tsx?|jsx?|css|json|md)$/;
const RESERVED = /^(acceptance\.|__preview__)/;
const MAX_TOTAL_BYTES = 300_000;
const MAX_FILES = 40;
const MAX_OUTPUT = 200_000;
const TIMEOUT_MS = 60_000;

function normalizeName(name: string): string {
  const norm = posix.normalize(name.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (norm.startsWith("..") || norm.includes("/../") || !ALLOWED_EXT.test(norm)) throw badRequest(`Arquivo não permitido: ${name}`);
  return norm;
}

/** Valida nomes (sem ../, sem caminho absoluto, sem nomes reservados) e tamanho da entrega. */
export function sanitizeFiles(files: Files): Files {
  const entries = Object.entries(files);
  if (entries.length === 0) throw badRequest("Entrega sem arquivos");
  if (entries.length > MAX_FILES) throw badRequest(`No máximo ${MAX_FILES} arquivos por entrega`);
  let total = 0;
  const out: Files = {};
  for (const [name, content] of entries) {
    const norm = normalizeName(name);
    if (RESERVED.test(posix.basename(norm))) throw badRequest(`Nome reservado para a bateria de aceite: ${name}`);
    total += Buffer.byteLength(content);
    out[norm] = content;
  }
  if (total > MAX_TOTAL_BYTES) throw badRequest("Entrega grande demais (máx. 300 KB)");
  return out;
}

/** Bateria de aceite: só arquivos de teste, gravados como acceptance.<nome> na raiz do src. */
export function sanitizeAcceptance(files: Files): Files {
  const out: Files = {};
  for (const [name, content] of Object.entries(files)) {
    const norm = normalizeName(name);
    if (!/\.test\.(tsx?|jsx?)$/.test(norm) || norm.includes("/")) throw badRequest(`Teste de aceite inválido: ${name} (use Nome.test.tsx)`);
    out[`acceptance.${norm}`] = content;
  }
  if (Object.keys(out).length === 0) throw badRequest("Bateria de aceite vazia");
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

/** Teste auxiliar que renderiza o componente e grava o HTML estático para a prévia. */
function previewTest(entry: string): string {
  const mod = `./${entry.replace(/\.(tsx|jsx)$/, "")}`;
  return `import * as M from ${JSON.stringify(mod)};
import { render } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
it("__preview__", () => {
  const all = M as Record<string, unknown>;
  const C = (all.default ?? Object.values(all).find((v) => typeof v === "function" && /^[A-Z]/.test((v as { name: string }).name))) as never;
  if (!C) return;
  const { container } = render(<C {...({ onSubmit: () => {} } as object)} />);
  writeFileSync("/work/report/preview.html", container.innerHTML);
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

type VitestJson = {
  numTotalTests?: number;
  testResults?: {
    name?: string;
    assertionResults?: { fullName?: string; title?: string; status?: string; failureMessages?: string[] }[];
  }[];
};

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
      failures: passed ? [] : [{ test: "estrutura", message: "A entrega precisa de um componente e de testes (*.test.tsx)." }],
      durationMs: 0,
    },
    previewHtml: null,
  };
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
    mkdirSync(report, { recursive: true });
    writeFiles(src, { ...files, ...(acceptance ?? {}) });
    const entry = entryComponent(files);
    if (entry) writeFiles(src, { "__preview__.test.tsx": previewTest(entry) });
    const name = `solvers-verify-${id}`;
    const t0 = Date.now();
    const timer = setTimeout(() => void docker(["kill", name]), TIMEOUT_MS);
    try {
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
      const jsonPath = join(report, "vitest.json");
      const json = existsSync(jsonPath) ? (JSON.parse(readFileSync(jsonPath, "utf8")) as VitestJson) : null;
      const results = (json?.testResults ?? []).flatMap((tr) =>
        (tr.assertionResults ?? []).map((a) => ({ file: tr.name ?? "", name: a.fullName ?? a.title ?? "teste", ok: a.status === "passed", msg: (a.failureMessages ?? []).join("\n") })),
      );
      const real = results.filter((t) => !t.file.includes("__preview__"));
      const acc = real.filter((t) => /acceptance\./.test(t.file));
      const failures = real.filter((t) => !t.ok).map((t) => ({ test: t.name, message: t.msg.slice(0, 800) }));
      const numPassed = real.filter((t) => t.ok).length;
      const accOk = !acceptance || (acc.length > 0 && acc.every((t) => t.ok));
      const previewPath = join(report, "preview.html");
      return {
        report: {
          passed: json != null && real.length > 0 && failures.length === 0 && accOk,
          mode: "docker",
          numTests: real.length,
          numPassed,
          numFailed: real.length - numPassed,
          acceptance: acceptance ? { numTests: acc.length, numPassed: acc.filter((t) => t.ok).length } : null,
          failures: json ? failures : [{ test: "execução", message: r.out.slice(-1500) || "Sem relatório de testes" }],
          durationMs: Date.now() - t0,
          log: json ? undefined : r.out.slice(-2000),
        },
        previewHtml: existsSync(previewPath) ? sanitizeHtml(readFileSync(previewPath, "utf8")) : null,
      };
    } finally {
      clearTimeout(timer);
      rmSync(base, { recursive: true, force: true });
    }
  });
}

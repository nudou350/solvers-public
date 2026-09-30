import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../env.js";

// Carrega os pacotes dos solvers do disco (INSTRUCTIONS.md 5.4 e 6). No MVP o servidor lê
// agents/<slug>; o conteúdo das etapas nunca sai inteiro: só a etapa corrente é entregue.

/** Um critério por item: ";" e quebra de linha separam critérios na contestação. */
const Criterion = z.string().min(2).max(300).refine((c) => !/[;\n]/.test(c), "critério não pode conter ';' nem quebra de linha");

export const Manifest = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  version: z.string(),
  catalogOnly: z.boolean().optional(),
  /** Usa get_memory/save_memory (se ausente, deduz pelas etapas). */
  usesMemory: z.boolean().optional(),
  creator: z.object({ id: z.string(), name: z.string(), bio: z.string(), avatarUrl: z.string().nullable().optional() }),
  requirements: z.array(z.object({ type: z.enum(["client", "connector", "plan"]), label: z.string(), key: z.string().optional() })),
  packageContents: z.array(z.string()),
  steps: z.array(z.object({ file: z.string(), title: z.string().optional(), gate: z.array(z.string()).default([]) })),
  tools: z.array(z.object({ name: z.string(), description: z.string(), runner: z.string() })).default([]),
  guarantee: z
    .object({
      available: z.boolean(),
      defaultCriteria: z.array(Criterion).default([]),
      /** Preço de uma tarefa com garantia (padrão: o preço da licença). */
      priceUsdc: z.number().positive().optional(),
      /** Etapas da tarefa: o comprador não as define, só descreve o que quer. */
      milestones: z
        .array(
          z.object({
            title: z.string().min(2).max(120),
            criteria: z.array(Criterion).min(1),
            /** % do preço; a soma das etapas é 100. */
            sharePct: z.number().min(1),
            /** tests: verificador automático; manual: o comprador revisa (ex: plano). */
            verify: z.enum(["tests", "manual"]).default("tests"),
          }),
        )
        .min(1)
        .max(5)
        .optional(),
    })
    .superRefine((g, ctx) => {
      if (!g.available) return;
      if (g.milestones && Math.abs(g.milestones.reduce((s, m) => s + m.sharePct, 0) - 100) > 0.001) {
        ctx.addIssue({ code: "custom", message: "guarantee.milestones: a soma de sharePct precisa ser 100" });
      }
      if (!g.milestones && g.defaultCriteria.length === 0) {
        ctx.addIssue({ code: "custom", message: "guarantee: sem milestones, defaultCriteria precisa de pelo menos um critério" });
      }
    }),
  pricing: z.object({ priceUsdc: z.number(), pricePerUseUsdc: z.number().nullable(), royaltyBps: z.number().int() }),
  beforeAfter: z.array(z.object({ prompt: z.string(), withoutSolver: z.string(), withSolver: z.string() })).default([]),
  versions: z
    .array(z.object({ version: z.string(), releasedAt: z.string(), notes: z.string() }))
    .default([]),
});
export type Manifest = z.infer<typeof Manifest>;

export type SolverPackage = {
  manifest: Manifest;
  dir: string;
  steps: { title: string; body: string; gate: string[] }[];
  versionHash: string;
  evalReport: { scoreBps: number; hash: string } | null;
  usesMemory: boolean;
};

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Hash determinístico do pacote: sha256 sobre (caminho relativo + sha256 do conteúdo) de todos os
 * arquivos em ordem alfabética, sem datas. Mesmo pacote => mesmo hash em qualquer máquina.
 * O relatório de evals fica de fora (ele é gerado depois e tem hash próprio on-chain).
 */
export function packageHash(dir: string): string {
  const h = createHash("sha256");
  const files = listFiles(dir)
    .map((f) => relative(dir, f).split(sep).join("/"))
    .filter((f) => f !== "evals/report.json")
    .sort();
  for (const rel of files) {
    const raw = readFileSync(join(dir, rel));
    // Texto com CRLF (checkout no Windows) e LF (VPS) precisa dar o mesmo hash.
    const content = /\.(md|json|tsx?|jsx?|css|txt|ya?ml)$/.test(rel) ? Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n")) : raw;
    h.update(rel);
    h.update("\0");
    h.update(createHash("sha256").update(content).digest());
  }
  return h.digest("hex");
}

export function loadPackage(dir: string): SolverPackage {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const steps = manifest.steps.map((s, i) => {
    const body = readFileSync(join(dir, s.file), "utf8");
    const title = s.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? `Etapa ${i + 1}`;
    return { title, body, gate: s.gate };
  });
  const reportPath = join(dir, "evals", "report.json");
  let evalReport: SolverPackage["evalReport"] = null;
  if (existsSync(reportPath)) {
    const raw = readFileSync(reportPath);
    const r = JSON.parse(raw.toString("utf8")) as { scoreBps?: number };
    evalReport = { scoreBps: Number(r.scoreBps ?? 0), hash: createHash("sha256").update(raw).digest("hex") };
  }
  const usesMemory = manifest.usesMemory ?? steps.some((s) => /(save_memory|get_memory)/.test(s.body));
  return { manifest, dir, steps, versionHash: packageHash(dir), evalReport, usesMemory };
}

let cache: Map<string, SolverPackage> | null = null;

export function agentsDir(): string {
  return resolve(process.cwd(), env.AGENTS_DIR);
}

/** Todos os pacotes, indexados por id e por slug. */
export function packages(): Map<string, SolverPackage> {
  if (cache) return cache;
  cache = new Map();
  const root = agentsDir();
  if (!existsSync(root)) return cache;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    try {
      const pkg = loadPackage(dir);
      cache.set(pkg.manifest.id, pkg);
      cache.set(pkg.manifest.slug, pkg);
    } catch (e) {
      console.error(`[runtime] pacote inválido em ${dir}:`, (e as Error).message);
    }
  }
  return cache;
}

export function getPackage(idOrSlug: string): SolverPackage | undefined {
  return packages().get(idOrSlug);
}

export function reloadPackages() {
  cache = null;
  return packages();
}

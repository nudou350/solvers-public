import { z } from "zod";
import { FREE_TRIAL_USES, Requirement } from "@solvers/shared";
import { AGENT_ID_RE, slugProblem, versionProblem } from "./agent-ids.js";

// Schema do manifest.json dos pacotes (INSTRUCTIONS.md 6). Sem env/banco: validado também nos testes.

/** Um critério por item: ";" e quebra de linha separam critérios na contestação. */
const Criterion = z.string().min(2).max(300).refine((c) => !/[;\n]/.test(c), "critério não pode conter ';' nem quebra de linha");

/** Forma do manifest (sem as verificações cruzadas): o validador v1 estende esta base. */
export const ManifestBase = z.object({
  id: z.string().regex(AGENT_ID_RE),
  /** Vira nome de pasta e chave de busca: formato fechado e nunca igual a um `id` (PACKAGE_SPEC.md 4.1). */
  slug: z.string().superRefine((s, ctx) => {
    const why = slugProblem(s);
    if (why) ctx.addIssue({ code: "custom", message: why });
  }),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  version: z.string().superRefine((v, ctx) => {
    const why = versionProblem(v);
    if (why) ctx.addIssue({ code: "custom", message: why });
  }),
  catalogOnly: z.boolean().optional(),
  /** Usa get_memory/save_memory (se ausente, deduz pelas etapas). */
  usesMemory: z.boolean().optional(),
  creator: z.object({ id: z.string(), name: z.string(), bio: z.string(), avatarUrl: z.string().nullable().optional() }),
  requirements: z.array(Requirement),
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
  /** Só licença vitalícia: pricePerUseUsdc de manifests antigos é ignorado. */
  pricing: z.object({ priceUsdc: z.number(), royaltyBps: z.number().int() }),
  /** Teste grátis com limites aplicados pelo servidor. Ausente ou available=false: sem teste. */
  trial: z
    .object({
      available: z.boolean().default(true),
      uses: z.number().int().min(1).max(10).default(FREE_TRIAL_USES),
      /** Etapas iniciais liberadas. */
      steps: z.number().int().min(1),
      /** Total de search_knowledge no teste inteiro. */
      searches: z.number().int().min(0),
      /** Total de execuções por ferramenta no teste inteiro; ferramenta ausente fica bloqueada. */
      tools: z.record(z.number().int().min(0)).default({}),
      summary: z.string().min(3).max(400),
      lockedSummary: z.string().min(3).max(300),
    })
    .optional(),
  /** Pedidos típicos com as palavras de quem compra ("quero um site bonito"): cada um vira um vetor da busca. */
  searchPhrases: z.array(z.string().min(3).max(120)).max(20).default([]),
  beforeAfter: z.array(z.object({ prompt: z.string(), withoutSolver: z.string(), withSolver: z.string() })).default([]),
  versions: z
    .array(z.object({ version: z.string(), releasedAt: z.string(), notes: z.string() }))
    .default([]),
});

/** Verificações entre campos (teste grátis x etapas e ferramentas). */
export function manifestCrossChecks(m: z.infer<typeof ManifestBase>, ctx: z.RefinementCtx): void {
  if (!m.trial) return;
  if (m.trial.steps > m.steps.length) {
    ctx.addIssue({ code: "custom", path: ["trial", "steps"], message: `trial.steps (${m.trial.steps}) maior que o número de etapas (${m.steps.length})` });
  }
  for (const name of Object.keys(m.trial.tools)) {
    if (!m.tools.some((t) => t.name === name)) {
      ctx.addIssue({ code: "custom", path: ["trial", "tools", name], message: `trial.tools: ferramenta "${name}" não existe em tools` });
    }
  }
}

export const Manifest = ManifestBase.superRefine(manifestCrossChecks);
export type Manifest = z.infer<typeof Manifest>;

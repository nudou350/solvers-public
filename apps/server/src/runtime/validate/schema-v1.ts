import { z } from "zod";
import { AGENT_ID_RE } from "../agent-ids.js";
import { ManifestBase } from "../manifest.js";

// Schema do manifesto `specVersion: 1` (PACKAGE_SPEC.md 4.1). Estende a base atual com os campos novos e é ESTRITO:
// campo desconhecido é erro (MANIFEST_UNKNOWN_FIELD). Pacotes v0 da plataforma continuam usando `Manifest`.

export const DIFFERENTIATORS = ["tool", "verifier", "liveData", "memory", "escalation"] as const;
export type Differentiator = (typeof DIFFERENTIATORS)[number];

/** Categorias aceitas (lista na config; PACKAGE_SPEC.md 4.1). */
export const CATEGORIES = ["Desenvolvimento", "Design", "Dia a dia", "Negócios", "Jurídico", "Finanças", "Viagens", "Conteúdo", "Escrita", "Outros"] as const;

/** Categorias que terceiros NÃO podem usar no Núcleo (decisão D13). */
export const NUCLEO_FORBIDDEN_CATEGORIES: readonly string[] = ["Jurídico", "Finanças"];

const Gate = z.union([
  z.string(),
  z.object({ text: z.string().min(2), evidence: z.object({ tool: z.string() }).strict() }).strict(),
]);

const Tool = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, "nome de ferramenta: minúsculas, dígitos e _"),
    description: z.string(),
    runner: z.string(),
    inputSchema: z.record(z.unknown()).optional(),
    outputSchema: z.record(z.unknown()).optional(),
    /** Só runners internos devolvem `passed: boolean`; vale como campo de sucesso para gates com evidência. */
    passField: z.string().optional(),
    http: z
      .object({
        method: z.enum(["GET", "POST"]),
        url: z.string(),
        allowedHosts: z.array(z.string()).min(1),
        headers: z.record(z.string()).optional(),
        timeoutMs: z.number().int().min(1000).max(20000).optional(),
      })
      .strict()
      .optional(),
    secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
    egress: z.boolean().optional(),
  })
  .strict();

const Question = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    ask: z.string().min(10).max(200),
    why: z.string().min(10).max(200),
    options: z.array(z.string().min(1).max(80)).min(2).max(6).optional(),
  })
  .strict();

const TrialBase = ManifestBase.shape.trial.unwrap();

export const ManifestV1Base = ManifestBase.extend({
  specVersion: z.literal(1),
  /** Ausente na 1ª versão: o servidor atribui e liga à carteira do criador. */
  id: z.string().regex(AGENT_ID_RE).optional(),
  steps: z.array(z.object({ file: z.string(), title: z.string().optional(), gate: z.array(Gate).default([]) }).strict()).min(1).max(12),
  tools: z.array(Tool).default([]),
  terms: z.object({ rightsConfirmed: z.boolean(), sourcesListed: z.boolean() }).strict().optional(),
  platform: z.boolean().optional(),
  knowledge: z
    .object({
      updatedAt: z.string(),
      reviewEveryDays: z.number().int().min(1).max(730),
      sources: z.array(z.string().min(2)).min(1),
    })
    .strict()
    .optional(),
  templates: z
    .array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/), path: z.string(), title: z.string(), description: z.string() }).strict())
    .default([]),
  onboarding: z.object({ questions: z.array(Question).min(1).max(5) }).strict().optional(),
  escalation: z.object({ enabled: z.boolean() }).strict().optional(),
  differentiators: z.array(z.enum(DIFFERENTIATORS)).max(5).default([]),
  trial: TrialBase.extend({ templates: z.array(z.string()).default([]) }).optional(),
}).strict();

export type ManifestV1 = z.infer<typeof ManifestV1Base>;

/** Verificações entre campos do v1 (as do v0 mais templates do teste). Os códigos saem do caminho (`path`). */
export function manifestV1CrossChecks(m: ManifestV1, ctx: z.RefinementCtx): void {
  if (!m.trial) return;
  if (m.trial.steps > m.steps.length) {
    ctx.addIssue({ code: "custom", path: ["trial", "steps"], message: `trial.steps (${m.trial.steps}) maior que o número de etapas (${m.steps.length})` });
  }
  for (const name of Object.keys(m.trial.tools)) {
    if (!m.tools.some((t) => t.name === name)) {
      ctx.addIssue({ code: "custom", path: ["trial", "tools", name], message: `trial.tools: ferramenta "${name}" não existe em tools` });
    }
  }
  for (const name of Object.keys(m.trial.toolLimits)) {
    if (!m.tools.some((t) => t.name === name)) {
      ctx.addIssue({ code: "custom", path: ["trial", "toolLimits", name], message: `trial.toolLimits: ferramenta "${name}" não existe em tools` });
    }
  }
  for (const name of m.trial.templates) {
    if (!m.templates.some((t) => t.name === name)) {
      ctx.addIssue({ code: "custom", path: ["trial", "templates", name], message: `trial.templates: template "${name}" não existe em templates` });
    }
  }
}

export const ManifestV1 = ManifestV1Base.superRefine(manifestV1CrossChecks);

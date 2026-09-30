import type { TrialInfo } from "@solvers/shared";
import type { Manifest } from "./manifest.js";
import type { SolverPackage } from "./packages.js";

// Teste grátis por especialista (manifest.trial): limites e textos. Funções puras (sem env/banco),
// testadas em test/trial.test.ts. Quem aplica os contadores é runtime/access.ts.

export type TrialLimits = {
  uses: number;
  steps: number;
  searches: number;
  /** Execuções por ferramenta no teste inteiro (só as liberadas, limite > 0). */
  tools: Record<string, number>;
  summary: string;
  lockedSummary: string;
};

/** O que a carteira já gastou do teste (tabela trials). */
export type TrialUsage = { searchesUsed: number; toolRuns: Record<string, number> };

/** Limites do teste do especialista, ou null quando ele não oferece teste grátis. */
export function trialLimits(m: Pick<Manifest, "trial">): TrialLimits | null {
  const t = m.trial;
  if (!t || !t.available) return null;
  const tools = Object.fromEntries(Object.entries(t.tools).filter(([, n]) => n > 0));
  return { uses: t.uses, steps: t.steps, searches: t.searches, tools, summary: t.summary, lockedSummary: t.lockedSummary };
}

/** Teste do especialista para a vitrine (AgentDetail.trial). */
export function trialInfo(pkg: Pick<SolverPackage, "manifest" | "steps">): TrialInfo | null {
  const t = trialLimits(pkg.manifest);
  if (!t) return null;
  return {
    uses: t.uses,
    steps: t.steps,
    totalSteps: pkg.steps.length,
    searches: t.searches,
    tools: Object.entries(t.tools).map(([name, limit]) => ({ name, limit })),
    summary: t.summary,
    lockedSummary: t.lockedSummary,
  };
}

/** Saldo do teste inteiro (GET /api/me/access). */
export function trialLeft(t: TrialLimits, usage: TrialUsage | null) {
  return {
    searchesLeft: Math.max(0, t.searches - (usage?.searchesUsed ?? 0)),
    toolsLeft: Object.fromEntries(Object.entries(t.tools).map(([name, limit]) => [name, Math.max(0, limit - (usage?.toolRuns[name] ?? 0))])),
  };
}

/** A etapa `index` (0-based) está fora do teste? O encerramento (index >= total) nunca fica bloqueado. */
export function trialStepLocked(t: TrialLimits, index: number, totalSteps: number): boolean {
  return index < totalSteps && index >= t.steps;
}

const clause = (s: string) => s.trim().replace(/[\s.;!]+$/, "");
export const times = (n: number) => (n === 1 ? "1 vez" : `${n} vezes`);

function listPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/**
 * Texto de fim do teste, para a IA repassar ao usuário (não é erro). Usado quando a próxima etapa,
 * a consulta à base ou a ferramenta pedida estão fora do que o teste libera.
 */
export function trialEndText(name: string, t: Pick<TrialLimits, "summary" | "lockedSummary">, purchaseLink: string): string {
  return `O teste grátis de ${name} vai até aqui: ${clause(t.summary)}. Com a licença vitalícia você também tem: ${clause(t.lockedSummary)}. Comprar: ${purchaseLink}`;
}

function stepsText(steps: number, total: number): string {
  if (steps >= total) return total === 1 ? "libera a etapa única" : `libera as ${total} etapas`;
  return steps === 1 ? `libera a etapa 1 de ${total}` : `libera as etapas 1 a ${steps} de ${total}`;
}

/**
 * Linha de acesso do activate_solver numa sessão de teste: os limites em português, para a IA
 * avisar o usuário antes de começar. `use` é o número deste uso (1..uses).
 */
export function trialAccessLine(
  t: TrialLimits,
  ctx: { use: number; totalSteps: number; toolNames: string[]; usage?: TrialUsage | null },
): string {
  const left = trialLeft(t, ctx.usage ?? null);
  const rest = (limit: number, remaining: number) => (remaining < limit ? ` (restam ${remaining})` : "");
  const parts = [stepsText(t.steps, ctx.totalSteps)];
  parts.push(t.searches > 0 ? `até ${t.searches} ${t.searches === 1 ? "consulta" : "consultas"} à base${rest(t.searches, left.searchesLeft)}` : "nenhuma consulta à base");
  for (const [name, limit] of Object.entries(t.tools)) parts.push(`${name} ${times(limit)}${rest(limit, left.toolsLeft[name] ?? 0)}`);
  const blocked = ctx.toolNames.filter((n) => !(n in t.tools));
  const lines = [
    `Teste grátis (uso ${ctx.use} de ${t.uses}): ${listPt(parts)} no total.`,
    blocked.length ? `Só com a licença: ${listPt(blocked)}.` : "",
    `${clause(t.summary)}.`,
    "Avise o usuário desses limites antes de começar.",
  ];
  return lines.filter(Boolean).join(" ");
}

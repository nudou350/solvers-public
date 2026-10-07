import type { MyTrial, TrialInfo } from "@solvers/shared";
import type { Manifest } from "./manifest.js";
import type { SolverPackage } from "./packages.js";

// Teste grátis por especialista (manifest.trial): limites e textos. Funções puras (sem env/banco),
// testadas em test/trial.test.ts. Quem aplica os contadores é runtime/access.ts.

/** Teto da entrada de uma ferramenta no teste: arquivos e bytes por execução. */
export type ToolCap = { maxFiles?: number; maxBytes?: number };

export type TrialLimits = {
  uses: number;
  steps: number;
  searches: number;
  /** Execuções por ferramenta no teste inteiro (só as liberadas, limite > 0). */
  tools: Record<string, number>;
  /** Teto da entrada por execução, só das ferramentas liberadas. */
  toolCaps: Record<string, ToolCap>;
  /** Templates liberados no teste (nomes de `trial.templates`; padrão nenhum). */
  templates: string[];
  /** Combinado do tamanho do pedido no teste, repassado à IA. */
  scope: string | null;
  summary: string;
  lockedSummary: string;
};

/** O que a carteira já gastou do teste (tabela trials). */
export type TrialUsage = { searchesUsed: number; toolRuns: Record<string, number> };

/** Limites do teste do especialista, ou null quando ele não oferece teste grátis. */
export function trialLimits(m: Pick<Manifest, "trial"> & { trial?: { templates?: string[] } }): TrialLimits | null {
  const t = m.trial;
  if (!t || !t.available) return null;
  const tools = Object.fromEntries(Object.entries(t.tools).filter(([, n]) => n > 0));
  const toolCaps = Object.fromEntries(Object.entries(t.toolLimits).filter(([name, cap]) => name in tools && (cap.maxFiles || cap.maxBytes)));
  return { uses: t.uses, steps: t.steps, searches: t.searches, tools, toolCaps, templates: t.templates ?? [], scope: t.scope ?? null, summary: t.summary, lockedSummary: t.lockedSummary };
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
    scope: t.scope,
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

/** Teste em andamento da carteira para a biblioteca (GET /me/trials). */
export function myTrial(agentId: string, t: TrialLimits, used: number, usage: TrialUsage, lastUsedAt: Date): MyTrial {
  const left = trialLeft(t, usage);
  return {
    agentId,
    uses: t.uses,
    usesLeft: Math.max(0, t.uses - used),
    searches: t.searches,
    searchesLeft: left.searchesLeft,
    tools: Object.entries(t.tools).map(([name, limit]) => ({ name, limit, left: left.toolsLeft[name] ?? 0 })),
    lastUsedAt: lastUsedAt.toISOString(),
  };
}

/** A etapa `index` (0-based) está fora do teste? O encerramento (index >= total) nunca fica bloqueado. */
export function trialStepLocked(t: TrialLimits, index: number, totalSteps: number): boolean {
  return index < totalSteps && index >= t.steps;
}

/** Tamanho da entrada de uma ferramenta: arquivos (quando vem { files }, em array ou objeto) e bytes. */
export function toolInputSize(input: unknown): { files: number | null; bytes: number } {
  const files = input && typeof input === "object" ? (input as { files?: unknown }).files : undefined;
  const entries: [string, string][] | null = Array.isArray(files)
    ? files.map((f) => [String(f?.path ?? ""), String(f?.content ?? "")])
    : files && typeof files === "object"
      ? Object.entries(files).map(([path, content]) => [path, String(content)])
      : null;
  if (!entries) return { files: null, bytes: Buffer.byteLength(JSON.stringify(input ?? null)) };
  return { files: entries.length, bytes: entries.reduce((a, [path, content]) => a + Buffer.byteLength(path) + Buffer.byteLength(content), 0) };
}

// O teto arredonda para baixo e o enviado para cima: quem passa do teto nunca lê "30 KB" contra "30 KB".
const capKb = (bytes: number) => `${Math.floor(bytes / 1000)} KB`;
const sentKb = (bytes: number) => `${Math.ceil(bytes / 1000)} KB`;

function capText(cap: ToolCap): string {
  const parts = [cap.maxFiles ? `${cap.maxFiles} ${cap.maxFiles === 1 ? "file" : "files"}` : "", cap.maxBytes ? capKb(cap.maxBytes) : ""].filter(Boolean);
  return listEn(parts);
}

/**
 * A entrada passa do teto da ferramenta no teste? Devolve o texto para a IA repassar (não é erro e
 * não gasta saldo), ou null quando cabe. Quem chama só aplica em sessão de teste.
 */
export function trialToolCapError(tool: string, cap: ToolCap | undefined, input: unknown, purchaseLink: string): string | null {
  if (!cap) return null;
  const size = toolInputSize(input);
  const tooMany = cap.maxFiles != null && size.files != null && size.files > cap.maxFiles;
  const tooBig = cap.maxBytes != null && size.bytes > cap.maxBytes;
  if (!tooMany && !tooBig) return null;
  const sent = [size.files != null ? `${size.files} ${size.files === 1 ? "file" : "files"}` : "", sentKb(size.bytes)].filter(Boolean).join(", ");
  return `Nothing was run and no free-trial balance was spent. In the free trial, ${tool} accepts up to ${capText(cap)} per run (you sent ${sent}). Send only the main component and its test, then run it again. The lifetime license removes this limit. Buy: ${purchaseLink}`;
}

const clause = (s: string) => s.trim().replace(/[\s.;!]+$/, "");
export const times = (n: number) => (n === 1 ? "1 time" : `${n} times`);

function listEn(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Texto de fim do teste, para a IA repassar ao usuário (não é erro). Usado quando a próxima etapa,
 * a consulta à base ou a ferramenta pedida estão fora do que o teste libera.
 */
export function trialEndText(name: string, t: Pick<TrialLimits, "summary" | "lockedSummary">, purchaseLink: string): string {
  return `The free trial of ${name} ends here: ${clause(t.summary)}. With the lifetime license you also get: ${clause(t.lockedSummary)}. Buy: ${purchaseLink}`;
}

/** Quantos usos grátis sobram depois deste; no último, avisa que o teste acaba aqui. */
function usesLeftText(left: number): string {
  if (left <= 0) return "This is the last free use.";
  return left === 1 ? "After this one, 1 free use is left." : `After this one, ${left} free uses are left.`;
}

function stepsText(steps: number, total: number): string {
  if (steps >= total) return total === 1 ? "unlocks the single step" : `unlocks all ${total} steps`;
  return steps === 1 ? `unlocks step 1 of ${total}` : `unlocks steps 1 to ${steps} of ${total}`;
}

/**
 * Linha de acesso do activate_solver numa sessão de teste: os limites em inglês, para a IA
 * avisar o usuário antes de começar. `use` é o número deste uso (1..uses).
 */
export function trialAccessLine(
  t: TrialLimits,
  ctx: { use: number; totalSteps: number; toolNames: string[]; usage?: TrialUsage | null },
): string {
  const left = trialLeft(t, ctx.usage ?? null);
  const rest = (limit: number, remaining: number) => (remaining < limit ? ` (${remaining} left)` : "");
  const parts = [stepsText(t.steps, ctx.totalSteps)];
  parts.push(t.searches > 0 ? `up to ${t.searches} knowledge base ${t.searches === 1 ? "search" : "searches"}${rest(t.searches, left.searchesLeft)}` : "no knowledge base searches");
  for (const [name, limit] of Object.entries(t.tools)) parts.push(`${name} ${times(limit)}${rest(limit, left.toolsLeft[name] ?? 0)}`);
  const blocked = ctx.toolNames.filter((n) => !(n in t.tools));
  const capped = Object.entries(t.toolCaps).map(([name, cap]) => `${name} accepts up to ${capText(cap)}`);
  const lines = [
    `Free trial (use ${ctx.use} of ${t.uses}): ${listEn(parts)} in total.`,
    usesLeftText(t.uses - ctx.use),
    blocked.length ? `License only: ${listEn(blocked)}.` : "",
    capped.length ? `Size limit per run in the trial: ${listEn(capped)}.` : "",
    t.templates.length ? `Templates available in the trial (get_template): ${listEn(t.templates)}.` : "",
    `${clause(t.summary)}.`,
    t.scope ? `Trial scope: ${clause(t.scope)}.` : "",
    "Tell the user about these limits before you start.",
  ];
  return lines.filter(Boolean).join(" ");
}

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
  /** Combinado do tamanho do pedido no teste, repassado à IA. */
  scope: string | null;
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
  const toolCaps = Object.fromEntries(Object.entries(t.toolLimits).filter(([name, cap]) => name in tools && (cap.maxFiles || cap.maxBytes)));
  return { uses: t.uses, steps: t.steps, searches: t.searches, tools, toolCaps, scope: t.scope ?? null, summary: t.summary, lockedSummary: t.lockedSummary };
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

const kb = (bytes: number) => `${Math.round(bytes / 1000)} KB`;

function capText(cap: ToolCap): string {
  const parts = [cap.maxFiles ? `${cap.maxFiles} ${cap.maxFiles === 1 ? "arquivo" : "arquivos"}` : "", cap.maxBytes ? kb(cap.maxBytes) : ""].filter(Boolean);
  return listPt(parts);
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
  const sent = [size.files != null ? `${size.files} ${size.files === 1 ? "arquivo" : "arquivos"}` : "", kb(size.bytes)].filter(Boolean).join(", ");
  return `Nada foi executado e o saldo do teste não foi gasto. No teste grátis, ${tool} aceita até ${capText(cap)} por execução (você enviou ${sent}). Envie só o componente principal e o teste dele e rode de novo. A licença vitalícia remove esse limite. Comprar: ${purchaseLink}`;
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

/** Quantos usos grátis sobram depois deste; no último, avisa que o teste acaba aqui. */
function usesLeftText(left: number): string {
  if (left <= 0) return "Este é o último uso grátis.";
  return left === 1 ? "Depois deste, resta 1 uso grátis." : `Depois deste, restam ${left} usos grátis.`;
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
  const capped = Object.entries(t.toolCaps).map(([name, cap]) => `${name} aceita até ${capText(cap)}`);
  const lines = [
    `Teste grátis (uso ${ctx.use} de ${t.uses}): ${listPt(parts)} no total.`,
    usesLeftText(t.uses - ctx.use),
    blocked.length ? `Só com a licença: ${listPt(blocked)}.` : "",
    capped.length ? `Limite de tamanho por execução no teste: ${listPt(capped)}.` : "",
    `${clause(t.summary)}.`,
    t.scope ? `Escopo do teste: ${clause(t.scope)}.` : "",
    "Avise o usuário desses limites antes de começar.",
  ];
  return lines.filter(Boolean).join(" ");
}

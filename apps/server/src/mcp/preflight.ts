import { memoryStartInstruction } from "../memory/rules.js";
import { installGuide, keyAliases, normalizeKey } from "./guides.js";

// Avaliação do preflight_check (pura, sem sessão nem banco): o que está ok, o que falta
// (bloqueia) e o que é opcional e está ausente (só avisa).

export type PreflightRequirement = {
  type: "client" | "connector" | "plan";
  label: string;
  key?: string;
  optional?: boolean;
  howTo?: string;
  helpUrl?: string;
};

/** Ferramentas do conector do Figma que podem aparecer sem "figma" no nome (com ou sem prefixo). */
const FIGMA_TOOL = /(^|_)get_(design_context|variable_defs|metadata|screenshot)$/;

/** Chave e nomes de ferramenta são comparados normalizados: "Google Drive" casa com "mcp__claude_ai_Google_Drive__search". */
export function connectorAvailable(key: string, tools: string[]): boolean {
  const k = normalizeKey(key);
  if (!k) return false;
  const names = tools.map(normalizeKey);
  const wanted = [k, ...keyAliases(k)];
  return names.some((t) => wanted.some((w) => t.includes(w))) || (k === "figma" && names.some((t) => FIGMA_TOOL.test(t)));
}

export function evaluatePreflight(requirements: PreflightRequirement[], availableTools: string[]) {
  const missing: string[] = [];
  const warnings: string[] = [];
  const ok: string[] = [];
  for (const r of requirements) {
    if (r.type === "connector") {
      const guide = installGuide(r);
      if (connectorAvailable(r.key ?? r.label, availableTools)) ok.push(`${r.label}: connected`);
      else if (r.optional) warnings.push(`${r.label} not connected: follow the no-connector path in step 1. If the user prefers to connect it:\n${guide}`);
      else missing.push(`${r.label}: NOT found.\n${guide}`);
    } else if (r.type === "plan") {
      ok.push(`${r.label}: recommended (does not block)`);
    } else {
      ok.push(`${r.label}: OK`);
    }
  }
  return { ok, missing, warnings, blocked: missing.length > 0 };
}

/** `memory`: o pacote usa memória (ou tem calibragem): o texto manda chamar get_memory antes da etapa 1 (PACKAGE_SPEC.md 10.2). */
export function preflightText(
  requirements: PreflightRequirement[],
  availableTools: string[],
  sessionId: string,
  memory?: { agentId: string; onboarding: boolean },
): string {
  const { ok, missing, warnings } = evaluatePreflight(requirements, availableTools);
  const list = (items: string[]) => items.map((m) => `- ${m}`).join("\n");
  const warnText = warnings.length ? `\n\nWarnings (do not block):\n${list(warnings)}` : "";
  if (missing.length) {
    return `Missing requirements:\n${list(missing)}\n\nGuide the user through installing them and, once they confirm, run preflight_check again. Do not move on to next_step before that.${warnText}${ok.length ? `\n\nAlready OK:\n${list(ok)}` : ""}`;
  }
  const memoryText = memory ? `\n\n${memoryStartInstruction(memory.agentId, memory.onboarding)}` : "";
  return `All set:\n${list(ok) || "- no requirements"}${warnText}${memoryText}\n\nNow call next_step with session_id="${sessionId}" to get step 1.`;
}

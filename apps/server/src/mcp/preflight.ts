import { INSTALL_GUIDES } from "./guides.js";

// Avaliação do preflight_check (pura, sem sessão nem banco): o que está ok, o que falta
// (bloqueia) e o que é opcional e está ausente (só avisa).

export type PreflightRequirement = { type: "client" | "connector" | "plan"; label: string; key?: string; optional?: boolean };

/** Ferramentas do conector do Figma que podem aparecer sem "figma" no nome (com ou sem prefixo). */
const FIGMA_TOOL = /(^|[^a-z0-9])get_(design_context|variable_defs|metadata|screenshot)$/;

export function connectorAvailable(key: string, tools: string[]): boolean {
  const k = key.toLowerCase();
  const names = tools.map((t) => t.toLowerCase());
  return names.some((t) => t.includes(k)) || (k === "figma" && names.some((t) => FIGMA_TOOL.test(t)));
}

export function evaluatePreflight(requirements: PreflightRequirement[], availableTools: string[]) {
  const missing: string[] = [];
  const warnings: string[] = [];
  const ok: string[] = [];
  for (const r of requirements) {
    if (r.type === "connector") {
      const key = (r.key ?? r.label).toLowerCase();
      const guide = INSTALL_GUIDES[key] ?? `Peça ao usuário para adicionar o conector ${r.label} nas configurações da IA.`;
      if (connectorAvailable(key, availableTools)) ok.push(`${r.label}: conectado`);
      else if (r.optional) warnings.push(`${r.label} não conectado: siga o caminho sem conector da etapa 1. Se o usuário preferir conectar:\n${guide}`);
      else missing.push(`${r.label}: NÃO encontrado.\n${guide}`);
    } else if (r.type === "plan") {
      ok.push(`${r.label}: recomendado (não bloqueia)`);
    } else {
      ok.push(`${r.label}: ok`);
    }
  }
  return { ok, missing, warnings, blocked: missing.length > 0 };
}

export function preflightText(requirements: PreflightRequirement[], availableTools: string[], sessionId: string): string {
  const { ok, missing, warnings } = evaluatePreflight(requirements, availableTools);
  const list = (items: string[]) => items.map((m) => `- ${m}`).join("\n");
  const warnText = warnings.length ? `\n\nAvisos (não bloqueiam):\n${list(warnings)}` : "";
  if (missing.length) {
    return `Faltam requisitos:\n${list(missing)}\n\nOriente o usuário a instalar e, quando ele confirmar, rode preflight_check de novo. Não avance para next_step antes disso.${warnText}${ok.length ? `\n\nJá ok:\n${list(ok)}` : ""}`;
  }
  return `Tudo pronto:\n${list(ok) || "- sem requisitos"}${warnText}\n\nAgora chame next_step com session_id="${sessionId}" para receber a etapa 1.`;
}

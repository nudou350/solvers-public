import type { IconName } from "@/components/ui/Icon";

// Diferenciais comprovados de um especialista (PACKAGE_SPEC.md 4.2 e 20), em linguagem simples.
// Valores desconhecidos (um diferencial novo no servidor) são ignorados em vez de aparecer cru.
export const DIFFERENTIATORS: Record<string, { label: string; text: string; icon: IconName }> = {
  memory: { label: "Memória", text: "Aprende as suas preferências e lembra de você na próxima conversa.", icon: "history" },
  escalation: { label: "Atendimento do criador", text: "Se travar, você pode pedir ajuda ao próprio criador.", icon: "message" },
  liveData: { label: "Dado vivo", text: "Conhecimento datado e mantido em dia, com fonte e data.", icon: "refresh" },
  tool: { label: "Ferramenta própria", text: "Executa uma ferramenta no servidor, além de conversar.", icon: "wrench" },
  verifier: { label: "Resultado verificado", text: "A entrega é conferida automaticamente por testes.", icon: "shield-check" },
};

export function differentiatorLabel(key: string): string {
  return DIFFERENTIATORS[key]?.label ?? key;
}

/** Só os diferenciais que a vitrine sabe nomear, na ordem em que vieram. */
export function knownDifferentiators(keys: readonly string[]): string[] {
  return keys.filter((k) => k in DIFFERENTIATORS);
}

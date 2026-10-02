// Pacote de exemplo da spec (PACKAGE_SPEC.md 23) em memória, compartilhado pelos testes do validador e da revisão.
// Não termina em .test.ts de propósito: o `node --test test/*.test.ts` não o executa sozinho.

export const NOW = new Date("2026-10-15T12:00:00Z");
export const ID = "0123456789abcdef0123456789abcdef";
export type Files = Record<string, string | Uint8Array>;

/** Etapa com as 5 seções e mais de 400 caracteres. */
export function step(n: number, extra = ""): string {
  const filler = "Explique ao usuário o que está sendo feito e confirme cada número antes de seguir. ".repeat(3);
  return [
    `# Etapa ${n}: Passo ${n}`,
    "",
    "## Objetivo",
    "",
    `Levantar os dados do mês e confirmar o perfil do usuário. ${filler}`,
    "",
    "## O que perguntar ao usuário",
    "",
    "1. Quais foram as receitas do mês? Aceite valores aproximados.",
    "",
    "## Como executar",
    "",
    `1. Consulte a base com search_knowledge.\n2. Monte a tabela do mês. ${extra}`,
    "",
    "## Erros comuns",
    "",
    "- Esquecer o acumulado do ano.",
    "",
    "## Formato do result_summary",
    "",
    "Um resumo curto com o total do mês e o que falta confirmar.",
    "",
  ].join("\n");
}

export const knowledgeDoc = (title: string, extra = "") =>
  `---\ntitle: ${title}\nsource: Receita Federal\nsource_url: https://www.gov.br/receitafederal/\nsource_date: 2026-09-01\nvalid_until: 2026-12-31\ntags: [das, valores]\n${extra}---\n\n# ${title}\n\nTexto do conhecimento sobre ${title}.\n`;

export const evalCase = (n: number) => JSON.stringify({ id: `caso-${n}`, input: `Pedido típico número ${n}`, checks: [{ type: "contains", value: "limite", description: "Fala do limite" }] });

export const baseManifest = () => ({
  specVersion: 1,
  slug: "fechamento-mei",
  name: "Fechamento do MEI",
  tagline: "Feche o mês do seu MEI sem erro: limite, DAS e relatório",
  description:
    "Conduz a IA por um fechamento mensal do MEI: levanta as receitas do mês, confere o limite anual de faturamento, calcula o DAS com os valores do ano e entrega um relatório pronto para guardar. A base traz as regras e os valores atuais com fonte e data. Não faz contabilidade completa nem declara imposto de renda.",
  category: "Negócios",
  version: "1.0.0",
  creator: { id: "x", name: "Contabilidade Simples", bio: "Contadores que atendem MEI há 10 anos" },
  terms: { rightsConfirmed: true, sourcesListed: true },
  requirements: [{ type: "client", label: "Claude ou ChatGPT", key: "any" }],
  packageContents: ["Método em 3 etapas com checklist", "Base com DAS e limites do ano, com fonte e data", "Modelo de relatório mensal", "Atendimento do criador em casos complexos"],
  searchPhrases: ["fechar o mês do MEI", "quanto pago de DAS"],
  differentiators: ["liveData", "memory", "escalation"],
  escalation: { enabled: true },
  usesMemory: true,
  steps: [
    { file: "steps/01-levantar.md", gate: ["Receitas do mês listadas", "Total do mês confirmado"] },
    { file: "steps/02-classificar.md", gate: ["Limite restante calculado"] },
    { file: "steps/03-relatorio.md", gate: ["Relatório entregue", "Aviso de conferir no portal oficial"] },
  ],
  knowledge: { updatedAt: "2026-09-30", reviewEveryDays: 90, sources: ["Receita Federal"] },
  templates: [{ name: "relatorio-mensal", path: "templates/relatorio-mensal.md", title: "Relatório mensal", description: "Receitas, limite e DAS do mês" }],
  onboarding: { questions: [{ id: "atividade", ask: "Qual é a atividade do seu MEI: comércio, serviço ou os dois?", why: "O valor do DAS muda conforme a atividade", options: ["Comércio", "Serviço", "Os dois"] }] },
  pricing: { priceUsdc: 9, royaltyBps: 0 },
  trial: { uses: 3, steps: 2, searches: 3, tools: {}, templates: [], summary: "Você faz as etapas 1 e 2.", lockedSummary: "O relatório fica na versão completa." },
  guarantee: { available: false, defaultCriteria: [] },
  versions: [{ version: "1.0.0", releasedAt: "2026-09-30", notes: "Primeira versão" }],
});

/** O exemplo da spec (§23) como pacote completo em memória. */
export function baseFiles(): Files {
  const f: Files = {
    "manifest.json": JSON.stringify(baseManifest()),
    "steps/01-levantar.md": step(1, "Use o perfil do usuário (atividade) para escolher o valor do DAS."),
    "steps/02-classificar.md": step(2),
    "steps/03-relatorio.md": step(3),
    "knowledge/das-mei-2026.md": knowledgeDoc("Valores do DAS-MEI em 2026"),
    "knowledge/limites-faturamento.md": knowledgeDoc("Limites de faturamento"),
    "templates/relatorio-mensal.md": "# Relatório mensal\n\nReceitas, limite e DAS do mês.\n",
    "README.md": "Nota ao revisor.",
  };
  for (let i = 1; i <= 10; i++) f[`evals/cases/caso-${String(i).padStart(2, "0")}.json`] = evalCase(i);
  return f;
}

export const editManifest = (f: Files, fn: (m: Record<string, unknown>) => void) => {
  const m = JSON.parse(f["manifest.json"] as string) as Record<string, unknown>;
  fn(m);
  f["manifest.json"] = JSON.stringify(m);
};

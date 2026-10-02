// Pacote v1 mínimo e honesto para o QA do fluxo de criação (e2e-creator.ts). Baseado no exemplo "Fechamento do MEI" da
// especificação (PACKAGE_SPEC.md 23); o nome e a descrição deixam claro que é um Solver de TESTE e os valores do MEI são só demonstração.
import { crc32, deflateRawSync } from "node:zlib";

export type QaPackageOpts = {
  slug?: string;
  version?: string;
  priceUsdc?: number;
  /** Notas da versão no changelog do manifesto. */
  notes?: string;
  /** Acrescenta/substitui campos do manifesto (testes negativos). */
  manifest?: Record<string, unknown>;
  /** Acrescenta/substitui arquivos (caminho relativo à raiz do pacote); `null` remove. */
  files?: Record<string, string | null>;
  /** Sufixo do conteúdo do conhecimento, para a nova versão ter o que o diff mostrar. */
  knowledgeExtra?: string;
};

export const QA_SLUG = "qa-fluxo-criador";

const step = (n: number, title: string, objective: string, ask: string, run: string, summary: string) => `# Etapa ${n}: ${title}

## Objetivo

${objective}

## O que perguntar ao usuário

${ask}

## Como executar

${run}

## Erros comuns

- Inventar valores que o usuário não informou: o que falta fica listado como pendência.
- Pedir senhas, CPF ou dados de acesso: não são necessários para nada nesta etapa.
- Entregar sem a ressalva de conferir tudo na fonte oficial.

## Formato do result_summary

${summary}
`;

export function qaPackageFiles(o: QaPackageOpts = {}): Record<string, string> {
  const slug = o.slug ?? QA_SLUG;
  const version = o.version ?? "1.0.0";
  const manifest: Record<string, unknown> = {
    specVersion: 1,
    slug,
    name: "QA Fluxo do Criador",
    tagline: "Solver de teste do fluxo de criação: fechamento mensal do MEI (demonstração)",
    description:
      "Solver de TESTE criado pela equipe para provar o fluxo de criação, revisão e publicação de pacotes. Conduz a IA por um fechamento mensal fictício de um MEI: levanta as receitas do mês, confere o limite anual, consulta o valor do DAS na base com fonte e data e entrega um relatório no modelo. Os valores são só demonstração. Não faz contabilidade, não declara imposto de renda e não substitui um contador: confira sempre no Portal do Empreendedor.",
    category: "Negócios",
    version,
    usesMemory: true,
    creator: { id: "meu-perfil", name: "Equipe QA", bio: "Perfil de teste usado pelo QA do fluxo de criação de Solvers." },
    terms: { rightsConfirmed: true, sourcesListed: true },
    requirements: [{ type: "client", label: "Claude ou ChatGPT", key: "any" }],
    packageContents: ["Método em 3 etapas com checklist", "Base com DAS e limites do ano, com fonte e data", "Modelo de relatório mensal"],
    searchPhrases: ["fechar o mês do MEI de teste", "quanto pago de DAS na demonstração", "estou perto do limite do MEI"],
    differentiators: ["liveData", "memory"],
    steps: [
      { file: "steps/01-levantar-notas.md", title: "Levantar as receitas do mês", gate: ["Receitas do mês listadas", "Total do mês confirmado com o usuário"] },
      { file: "steps/02-classificar.md", title: "Limite e DAS", gate: ["Acumulado do ano e limite restante calculados", "DAS do mês conferido na base com a data da fonte"] },
      { file: "steps/03-gerar-guia.md", title: "Relatório do mês", gate: ["Relatório do mês entregue", "Aviso de conferir no portal oficial"] },
    ],
    knowledge: { updatedAt: "2026-10-02", reviewEveryDays: 90, sources: ["Receita Federal", "Portal do Empreendedor"] },
    templates: [{ name: "relatorio-mensal", path: "templates/relatorio-mensal.md", title: "Relatório mensal", description: "Receitas, limite e DAS do mês" }],
    onboarding: {
      questions: [{ id: "atividade", ask: "Qual é a atividade do seu MEI: comércio, serviço ou os dois?", why: "O valor do DAS muda conforme a atividade", options: ["Comércio", "Serviço", "Os dois"] }],
    },
    guarantee: { available: false, defaultCriteria: [] },
    pricing: { priceUsdc: o.priceUsdc ?? 5, royaltyBps: 0 },
    trial: {
      uses: 3,
      steps: 2,
      searches: 3,
      tools: {},
      templates: [],
      summary: "Você faz as etapas 1 e 2: receitas do mês, limite restante e DAS conferido na base.",
      lockedSummary: "O relatório do mês e o modelo pronto ficam na versão completa.",
    },
    versions: [{ version, releasedAt: "2026-10-02", notes: o.notes ?? "Primeira versão (teste do fluxo)" }],
    ...o.manifest,
  };

  const evalCase = (id: string, input: string, checks: unknown[]) => [`evals/cases/${id}.json`, JSON.stringify({ id, input, checks }, null, 2)] as const;
  const cases = [
    evalCase("01-fechar-mes", "Vendi 3 coisas este mês: 500, 800 e 1200. Fecha o mês para mim.", [
      { type: "regex", value: "2\\.?500", description: "Total do mês correto (2.500)" },
      { type: "regex", value: "confirm", description: "Pede a confirmação do total" },
    ]),
    evalCase("02-limite-restante", "Já faturei 60 mil até o mês passado e este mês fiz 5 mil. Quanto falta do limite?", [
      { type: "regex", value: "16\\.?000|16 mil", description: "Restante do limite correto (16 mil)" },
      { type: "contains", value: "81", description: "Cita o limite anual de 81 mil" },
    ]),
    evalCase("03-das-servico", "Meu MEI é de serviço. Quanto é o DAS?", [
      { type: "contains", value: "86,05", description: "Valor do DAS de serviço na base" },
      { type: "regex", value: "fonte|Receita|Portal", description: "Cita a fonte" },
    ]),
    evalCase("04-das-comercio", "Meu MEI é comércio, quanto pago de DAS?", [
      { type: "contains", value: "82,05", description: "Valor do DAS de comércio na base" },
      { type: "regex", value: "dia 20|vence", description: "Informa o vencimento" },
    ]),
    evalCase("05-sem-dados", "Fecha meu mês.", [
      { type: "regex", value: "quais|qual|informe", description: "Pergunta o que falta em vez de inventar" },
      { type: "not_contains", value: "seu total é", description: "Não inventa total" },
    ]),
    evalCase("06-imposto-de-renda", "Pode fazer minha declaração de imposto de renda?", [
      { type: "regex", value: "fora d(o|a) (meu )?escopo|n[ãa]o (fa[çc]o|cubro)|contador", description: "Declara que está fora do escopo" },
      { type: "not_contains", value: "claro, vou fazer", description: "Não aceita o que está fora do escopo" },
    ]),
    evalCase("07-sem-multa", "Garanta que eu não vou tomar multa.", [
      { type: "regex", value: "n[ãa]o (posso|consigo) garantir|n[ãa]o h[áa] garantia", description: "Recusa garantir" },
      { type: "regex", value: "confira|portal", description: "Manda conferir no portal" },
    ]),
    evalCase("08-inicio", "Oi, quero fechar o mês do meu MEI.", [
      { type: "regex", value: "atividade|com[ée]rcio|servi[çc]o", description: "Usa ou pede o perfil (atividade)" },
      { type: "regex", value: "m[êe]s", description: "Confirma o mês do fechamento" },
    ]),
    evalCase("09-fonte-vencida", "Qual o valor do DAS? O trecho da base veio com aviso de desatualizado.", [
      { type: "regex", value: "desatualizad|vencid|confirme", description: "Repassa o aviso de desatualizado" },
      { type: "regex", value: "Portal|oficial", description: "Manda conferir na fonte oficial" },
    ]),
    evalCase("10-relatorio-final", "Gere o relatório do mês.", [
      { type: "regex", value: "Receitas|Limite|DAS", description: "Usa as seções do modelo" },
      { type: "regex", value: "n[ãa]o substitui|contador", description: "Inclui a ressalva" },
    ]),
  ];

  const files: Record<string, string | null> = {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "steps/01-levantar-notas.md": step(
      1,
      "Levantar as receitas do mês",
      "Listar todas as receitas do mês do MEI e confirmar o total com o usuário, para que o limite e o DAS sejam calculados sobre números certos. Fale simples: o usuário normalmente não é contador. Estas instruções são de um Solver de teste.",
      "1. Qual é o mês (e o ano) do fechamento?\n2. Quais foram as vendas ou serviços do mês, com o valor de cada um? Aceite uma lista colada, um resumo ou valores aproximados (marque como estimativa).\n3. Alguma receita deste mês ainda não foi recebida? Conte pela data da venda ou do serviço.",
      "1. Consulte o perfil com `get_memory`. Se existir, confirme a atividade numa frase; se estiver vazio ou pulado, siga e pergunte só quando a etapa 2 precisar.\n2. Faça as perguntas acima de uma vez, agrupadas.\n3. Monte uma tabela com data, descrição e valor. Some e mostre o total do mês com duas casas decimais.\n4. Pergunte se falta algo e só então peça a confirmação do total.\n5. Nunca invente valores: o que o usuário não informou fica fora do total e é listado como pendência.",
      "RECEITAS: mês/ano; N lançamentos; total do mês (R$); estimativas (sim/não, quais); pendências; atividade do perfil (comércio, serviço ou os dois).",
    ),
    "steps/02-classificar.md": step(
      2,
      "Limite e DAS",
      "Calcular quanto do limite anual de faturamento já foi usado e quanto resta, e conferir o valor do DAS do mês na base, citando a fonte e a data. Use o perfil do usuário para escolher o valor certo conforme a atividade.",
      "1. Qual foi o faturamento acumulado de janeiro até o mês anterior? Aceite um valor aproximado e marque como estimativa.\n2. O MEI foi aberto neste ano? Em que mês? (O limite é proporcional no ano de abertura.)",
      "1. Leia o perfil (`get_memory`): a atividade define o valor do DAS (comércio, serviço ou os dois). Se estiver vazio, pergunte a atividade agora.\n2. Some o acumulado anterior ao total do mês (resumo da etapa 1) e calcule o restante do limite.\n3. Consulte `search_knowledge` com \"valor do DAS do MEI por atividade\" e \"limite de faturamento do MEI\". Cite a fonte e a data do trecho; se avisar que pode estar desatualizado, diga isso.\n4. Se o acumulado passar do limite, explique que a situação muda e oriente a falar com um contador; não decida pelo usuário.\n5. Mostre: acumulado, restante, valor do DAS, vencimento e a fonte com a data.",
      "LIMITE: acumulado; restante; situação (dentro, perto, acima). DAS: atividade; valor; vencimento; fonte e data citadas.",
    ),
    "steps/03-gerar-guia.md": step(
      3,
      "Relatório do mês",
      "Entregar o relatório do mês no modelo pronto, com receitas, limite e DAS, e a ressalva de conferir tudo no portal oficial. É a entrega que o usuário guarda.",
      "1. Quer incluir observações no relatório (por exemplo, uma receita pendente)?",
      "1. Chame `get_template` com o nome `relatorio-mensal`.\n2. Preencha com os resultados das etapas 1 e 2. Não acrescente números novos.\n3. Mostre o relatório e confirme com o usuário.\n4. Inclua sempre a ressalva: \"Confira os valores e o pagamento do DAS no Portal do Empreendedor; isto não substitui um contador\".\n5. Se o usuário pedir para salvar um lembrete (por exemplo, \"meu MEI é de serviço\"), pergunte se quer que você salve como nota e use `save_memory`.",
      "ENTREGA: relatório mensal gerado; ressalva incluída (sim); observações; nota salva (sim/não).",
    ),
    "knowledge/das-mei-2026.md": `---
title: Valores do DAS-MEI em 2026 (demonstração)
source: Receita Federal
source_url: https://www.gov.br/receitafederal/
source_date: 2026-01-15
valid_until: 2026-12-31
tags: [das, valores]
---

# Valores do DAS-MEI em 2026

## DAS-MEI por atividade em 2026

O DAS-MEI é a guia mensal do MEI: 5% do salário mínimo mais R$ 1,00 de ICMS (comércio e indústria) e/ou R$ 5,00 de ISS (serviços). Com o salário mínimo de 2026 em R$ 1.621,00, os valores desta demonstração são: comércio R$ 82,05; serviços R$ 86,05; comércio e serviços R$ 87,05. Valores de demonstração: num Solver real, confirme no Portal do Empreendedor.

## Vencimento do DAS-MEI

O DAS-MEI vence no dia 20 do mês seguinte ao da competência. Se o dia 20 não for útil, o pagamento segue o calendário da Receita. Confirme no Portal do Empreendedor.
${o.knowledgeExtra ?? ""}`,
    "knowledge/limites-faturamento.md": `---
title: Limite de faturamento do MEI (demonstração)
source: Portal do Empreendedor, regras do MEI
source_date: 2026-01-15
valid_until: 2026-12-31
tags: [limite, faturamento]
---

# Limite de faturamento do MEI

## Limite anual de faturamento do MEI

O limite de receita bruta do MEI é de R$ 81.000,00 por ano, ou R$ 6.750,00 por mês de atividade, na proporção, quando o MEI abriu no ano. Para uma situação acima do limite, o usuário deve procurar um contador: as consequências dependem do valor excedido e do caso.
`,
    "templates/relatorio-mensal.md": `# Relatório mensal do MEI: MÊS/ANO

## Receitas do mês
Tabela com data, descrição e valor; total do mês.

## Limite anual
Acumulado até o mês; restante; situação.

## DAS do mês
Atividade; valor; vencimento; fonte e data.

## Atenção
Confira os valores e o pagamento no Portal do Empreendedor. Este relatório não substitui um contador.
`,
    "README.md": "# Nota ao revisor\n\nSolver de TESTE do QA do fluxo de criação. Diferenciais: liveData (base datada com fonte) e memory (calibragem da atividade usada na etapa 2). Valores do MEI são só demonstração.\n",
    ...Object.fromEntries(cases),
  };
  for (const [k, v] of Object.entries(o.files ?? {})) {
    if (v === null) delete files[k];
    else files[k] = v;
  }
  return files as Record<string, string>;
}

// ---------------------------------------------------------------------------------------------------------------
// ZIP à mão (inclui as entradas malformadas dos testes negativos). Mesmo formato do test/helpers/zip-builder.ts do servidor.

export type ZipSpec = { name: string; data?: Buffer | string; method?: 0 | 8; declaredSize?: number; symlink?: boolean };

export function buildZip(specs: ZipSpec[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const s of specs) {
    const name = Buffer.from(s.name, "utf8");
    const raw = Buffer.isBuffer(s.data) ? s.data : Buffer.from(s.data ?? "", "utf8");
    const method = s.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const declared = s.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(declared, 24);
    cd.writeUInt16LE(name.length, 28);
    const mode = s.symlink ? 0o120777 : name.at(-1) === 0x2f ? 0o040755 : 0o100644;
    cd.writeUInt32LE((mode << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(specs.length, 8);
  end.writeUInt16LE(specs.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

/** ZIP com pasta raiz única (como o criador o envia). */
export function zipOfFiles(files: Record<string, string>, root = QA_SLUG): Buffer {
  return buildZip(Object.entries(files).map(([path, data]) => ({ name: `${root}/${path}`, data })));
}

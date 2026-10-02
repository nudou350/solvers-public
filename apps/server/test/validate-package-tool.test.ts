import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { z } from "zod";
import { buildPackage, MAX_INPUT_BYTES, summarize, validatePackageTool, ValidatePackageInput } from "../src/runtime/validate-package-tool.js";
import type { SolverPackage } from "../src/runtime/package-loader.js";

// Ferramenta builtin:validate-package do Criador de Solvers (PACKAGE_SPEC.md 13 e 19). Sem env nem banco.

const STEP = `# Receitas do mês

## Objetivo
Somar as receitas do mês do MEI e conferir o limite anual de faturamento, para que o usuário saiba quanto ainda pode faturar sem sair do regime.

## O que perguntar ao usuário
- Quais notas fiscais ou recibos de receita existem neste mês?
- Algum valor entrou por transferência sem nota?

## Como executar
1. Peça a lista de receitas do mês, uma por linha, com data e valor.
2. Some os valores e compare com o limite anual informado na base de conhecimento.
3. Mostre ao usuário o total do mês, o acumulado do ano e quanto resta do limite.

## Erros comuns
- Esquecer receitas recebidas em dinheiro ou por Pix sem nota fiscal emitida.

## Formato do result_summary
Total do mês, acumulado do ano e limite restante, em reais, em uma linha cada.
`;

const manifest = (over: Record<string, unknown> = {}) => ({
  specVersion: 1,
  slug: "fechamento-do-mei",
  name: "Fechamento do MEI",
  tagline: "Fecha o mês do seu MEI sem esquecer o limite de faturamento",
  description:
    "Guia o microempreendedor individual no fechamento mensal: soma as receitas, confere o limite anual de faturamento e monta o relatório do mês. Não faz a declaração anual, não substitui o contador e não calcula impostos de outros regimes.",
  category: "Negócios",
  version: "1.0.0",
  creator: { id: "x", name: "Maria", bio: "Contadora" },
  requirements: [],
  packageContents: ["Método em uma etapa com checklist", "Relatório mensal pronto", "Limite do MEI conferido"],
  steps: [{ file: "steps/01-receitas.md", gate: ["Receitas do mês somadas", "Limite anual conferido"] }],
  pricing: { priceUsdc: 5, royaltyBps: 500 },
  guarantee: { available: false, defaultCriteria: [] },
  terms: { rightsConfirmed: true, sourcesListed: true },
  versions: [{ version: "1.0.0", releasedAt: "2026-10-01", notes: "Primeira versão" }],
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({ manifest: manifest(), steps: [{ file: "steps/01-receitas.md", content: STEP }], ...over });

describe("validatePackageTool: entrada boa", () => {
  it("manifesto e etapa válidos: ok, sem erros, summary em português e stats", () => {
    const out = validatePackageTool(input());
    assert.deepEqual(out.errors, []);
    assert.equal(out.ok, true);
    assert.equal(out.stats.steps, 1);
    assert.equal(out.stats.specVersion, 1);
    assert.match(out.summary, /Manifesto e etapas sem erros/);
    assert.match(out.summary, /validação completa/);
    // Sem conhecimento nem evals na entrada: o resumo avisa que não foram conferidos (e não reclama de falta de casos).
    assert.match(out.summary, /conhecimento não foi enviado/);
    assert.match(out.summary, /casos de eval não foram enviados/);
    assert.ok(!out.warnings.some((w) => w.code === "EVAL_TOO_FEW_CASES"));
  });

  it("a resposta tem o formato { ok, errors, warnings, stats, summary }", () => {
    assert.deepEqual(Object.keys(validatePackageTool(input())).sort(), ["errors", "ok", "stats", "summary", "warnings"]);
  });
});

describe("validatePackageTool: erros com code, path, message e fix", () => {
  it("terceiro sem specVersion, platform e tools internas viram erro", () => {
    const out = validatePackageTool(input({ manifest: manifest({ specVersion: undefined, platform: true, tools: [{ name: "validate_package", description: "x", runner: "builtin:validate-package" }] }) }));
    assert.equal(out.ok, false);
    const codes = out.errors.map((e) => e.code);
    assert.ok(codes.includes("MANIFEST_SPEC_VERSION"), codes.join());
    assert.ok(codes.includes("MANIFEST_PLATFORM_FORBIDDEN"), codes.join());
    assert.ok(codes.includes("TOOL_FORBIDDEN_RUNNER"), codes.join());
    for (const e of out.errors) {
      assert.ok(e.code && e.message && e.fix, JSON.stringify(e));
      assert.equal(typeof e.path, "string");
    }
  });

  it("etapa curta demais e sem seções: erro por seção, apontando o arquivo", () => {
    const out = validatePackageTool(input({ steps: [{ file: "steps/01-receitas.md", content: "# Só um título\n\nPouco texto." }] }));
    assert.equal(out.ok, false);
    const sections = out.errors.filter((e) => e.code === "STEP_SECTION_MISSING");
    assert.equal(sections.length, 3);
    assert.ok(sections.every((e) => e.path === "steps/01-receitas.md"));
    assert.ok(out.errors.some((e) => e.code === "STEP_TOO_SHORT_LONG"));
  });

  it("etapa declarada sem o texto enviado: STEP_FILE_MISSING", () => {
    const out = validatePackageTool(input({ steps: [] }));
    assert.ok(out.errors.some((e) => e.code === "STEP_FILE_MISSING" && e.path.endsWith("steps.0.file")));
  });

  it("slug reservado, categoria proibida e preço abaixo do mínimo", () => {
    const out = validatePackageTool(input({ manifest: manifest({ slug: "criador-de-solvers", category: "Jurídico", pricing: { priceUsdc: 2, royaltyBps: 0 } }) }));
    const codes = out.errors.map((e) => e.code);
    assert.ok(codes.includes("MANIFEST_SLUG_RESERVED"), codes.join());
    assert.ok(codes.includes("MANIFEST_CATEGORY_FORBIDDEN"), codes.join());
    assert.ok(codes.includes("MANIFEST_PRICE_BELOW_MIN"), codes.join());
  });

  it("o summary lista os erros, manifesto primeiro, com o que corrigir", () => {
    const out = validatePackageTool(input({ manifest: manifest({ terms: undefined }), steps: [{ file: "steps/01-receitas.md", content: "curto" }] }));
    assert.match(out.summary, /erros? para corrigir\. Comece por:/);
    assert.match(out.summary, /1\) TERMS_MISSING/);
    assert.match(out.summary, /Corrija:/);
    const first = out.summary.split("\n")[1]!;
    assert.match(first, /^1\) /);
  });

  it("campo desconhecido no manifesto: MANIFEST_UNKNOWN_FIELD com o caminho do campo", () => {
    const out = validatePackageTool(input({ manifest: manifest({ inventado: 1 }) }));
    assert.ok(out.errors.some((e) => e.code === "MANIFEST_UNKNOWN_FIELD" && e.path === "manifest.json#inventado"));
  });
});

describe("validatePackageTool: arquivos, conhecimento, templates e evals", () => {
  const knowledge = `---\nsource: Receita Federal\nsource_date: 2026-01-10\n---\n# Limite do MEI\n\nO limite anual é de 81 mil reais.`;

  it("conhecimento com front-matter passa; sem fonte é erro", () => {
    const ok = validatePackageTool(input({ knowledge: [{ path: "knowledge/limite.md", head: knowledge }] }));
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.stats.knowledgeFiles, 1);
    assert.doesNotMatch(ok.summary, /conhecimento não foi enviado/);
    const bad = validatePackageTool(input({ knowledge: [{ path: "knowledge/limite.md", head: "# Sem fonte\n\ntexto" }] }));
    assert.ok(bad.errors.some((e) => e.code === "KNOWLEDGE_SOURCE_MISSING"));
  });

  it("o teto de trechos não se aplica ao começo dos arquivos (não há como estimar)", () => {
    const out = validatePackageTool(input({ knowledge: [{ path: "knowledge/limite.md", head: knowledge }], files: [{ path: "knowledge/limite.md", size: 9_000_000 }] }));
    assert.ok(!out.errors.some((e) => e.code === "KNOWLEDGE_TOO_BIG"));
  });

  it("template declarado sem arquivo é erro só quando a entrada diz quais arquivos existem", () => {
    const m = manifest({ templates: [{ name: "relatorio", path: "templates/relatorio.md", title: "Relatório", description: "Relatório do mês" }] });
    assert.ok(!validatePackageTool(input({ manifest: m })).errors.some((e) => e.code === "TEMPLATE_MISSING"), "sem files nem templates, não dá para saber");
    assert.ok(validatePackageTool(input({ manifest: m, files: [{ path: "manifest.json", size: 100 }] })).errors.some((e) => e.code === "TEMPLATE_MISSING"));
    const ok = validatePackageTool(input({ manifest: m, templates: [{ path: "templates/relatorio.md", content: "# Relatório" }] }));
    assert.ok(!ok.errors.some((e) => e.code === "TEMPLATE_MISSING"));
  });

  it("casos de eval enviados são conferidos (inválido é erro); poucos casos só contam se vierem evals", () => {
    const bad = validatePackageTool(input({ evals: [{ path: "evals/cases/a.json", content: "{ nao json" }] }));
    assert.ok(bad.errors.some((e) => e.code === "EVAL_CASE_INVALID"));
    assert.ok(bad.errors.some((e) => e.code === "EVAL_TOO_FEW_CASES"), "com evals na entrada o mínimo vale");
  });

  it("eval ou conhecimento sem a pasta no caminho: o resumo avisa que não contam (e com o caminho certo, não avisa)", () => {
    const caseJson = JSON.stringify({ id: "a", input: "pedido", checks: [{ type: "contains", value: "x", description: "d" }] });
    const short = validatePackageTool(input({ evals: [{ path: "a.json", content: caseJson }], knowledge: [{ path: "tema.md", head: knowledge }] }));
    assert.match(short.summary, /evals\/cases\/NN-nome\.json/);
    assert.match(short.summary, /knowledge\/nome\.md/);
    const full = validatePackageTool(input({ evals: [{ path: "evals/cases/a.json", content: caseJson }], knowledge: [{ path: "knowledge/tema.md", head: knowledge }] }));
    assert.doesNotMatch(full.summary, /caminho completo/);
  });

  it("tipo de arquivo fora do Núcleo na lista de arquivos: FILE_TYPE_NOT_ALLOWED", () => {
    const out = validatePackageTool(input({ files: [{ path: "manifest.json", size: 10 }, { path: "knowledge/livro.pdf", size: 1000 }] }));
    assert.ok(out.errors.some((e) => e.code === "FILE_TYPE_NOT_ALLOWED" && e.path === "knowledge/livro.pdf"));
  });
});

describe("validatePackageTool: entrada inválida", () => {
  it("campo extra, tipos errados e caminho repetido são recusados", () => {
    assert.throws(() => validatePackageTool({ ...input(), extra: 1 }), z.ZodError);
    assert.throws(() => validatePackageTool({ manifest: "texto", steps: [] }), z.ZodError);
    assert.throws(() => validatePackageTool({ steps: [] }), z.ZodError);
    assert.throws(
      () => validatePackageTool(input({ steps: [{ file: "steps/01-receitas.md", content: STEP }], templates: [{ path: "steps/01-receitas.md", content: "x" }] })),
      (e: unknown) => (e as { status?: number }).status === 400 && /mais de uma vez/.test((e as Error).message),
    );
  });

  it("acima de 1 MB: 400 com o motivo", () => {
    const big = "x".repeat(190_000);
    const steps = Array.from({ length: 6 }, (_, i) => ({ file: `steps/0${i}.md`, content: big }));
    assert.throws(() => validatePackageTool({ manifest: manifest(), steps }), (e: unknown) => (e as { status?: number }).status === 400 && new RegExp(String(MAX_INPUT_BYTES)).test((e as Error).message));
  });

  it("ValidatePackageInput aceita só o contrato (manifest, steps, files, knowledge, templates, evals)", () => {
    assert.equal(ValidatePackageInput.safeParse(input({ files: [{ path: "a.md", size: 1 }], knowledge: [], templates: [], evals: [] })).success, true);
    assert.equal(ValidatePackageInput.safeParse(input({ files: [{ path: "a.md", size: -1 }] })).success, false);
  });
});

describe("buildPackage", () => {
  it("o tamanho do arquivo vem de files quando existe; senão, do conteúdo", () => {
    const pkg = buildPackage(ValidatePackageInput.parse(input({ files: [{ path: "steps/01-receitas.md", size: 777 }] })));
    assert.equal(pkg.entries.find((e) => e.path === "steps/01-receitas.md")!.size, 777);
    const noFiles = buildPackage(ValidatePackageInput.parse(input()));
    assert.equal(noFiles.entries.find((e) => e.path === "steps/01-receitas.md")!.size, Buffer.byteLength(STEP));
    assert.ok(noFiles.read("manifest.json"));
    assert.equal(noFiles.read("nao-existe.md"), undefined);
  });
});

describe("summarize", () => {
  const e = (code: string) => ({ code: code as never, path: "p", message: "m", fix: "f" });
  it("mostra no máximo 5 e diz quantos restam", () => {
    const s = summarize(Array.from({ length: 8 }, () => e("STEP_SECTION_MISSING")), []);
    assert.match(s, /8 erros para corrigir/);
    assert.match(s, /5\) /);
    assert.doesNotMatch(s, /6\) /);
    assert.match(s, /restam 3/);
  });
  it("sem erros e com avisos, conta os avisos", () => {
    assert.match(summarize([], [e("TEXT_HIDDEN_CHARS"), e("TEXT_HIDDEN_CHARS")]), /Há 2 avisos/);
    assert.match(summarize([], [e("TEXT_HIDDEN_CHARS")]), /Há 1 aviso /);
  });
});

describe("runServerTool: builtin:validate-package só roda em pacote da plataforma", () => {
  let runServerTool: typeof import("../src/runtime/tools.js").runServerTool;
  before(async () => {
    // tools.ts importa o verificador, que lê o env do servidor: valores de mentira bastam (nada é chamado aqui).
    Object.assign(process.env, {
      USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      FEE_PAYER_KEYPAIR: process.env.FEE_PAYER_KEYPAIR ?? "x",
      VERIFIER_KEYPAIR: process.env.VERIFIER_KEYPAIR ?? "x",
      USAGE_AUTHORITY_KEYPAIR: process.env.USAGE_AUTHORITY_KEYPAIR ?? "x",
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
    });
    ({ runServerTool } = await import("../src/runtime/tools.js"));
  });

  const pkg = (source: "agents" | "published"): SolverPackage =>
    ({
      manifest: { id: "c71ad0a50f750e75c71ad0a50f750e75", slug: "criador-de-solvers", tools: [{ name: "validate_package", description: "d", runner: "builtin:validate-package" }] } as never,
      dir: "/x",
      steps: [],
      versionHash: "",
      evalReport: null,
      usesMemory: false,
      source,
    }) as SolverPackage;

  it("pacote da plataforma executa", async () => {
    const out = (await runServerTool(pkg("agents"), "validate_package", input())) as { ok: boolean };
    assert.equal(out.ok, true);
  });

  it("pacote de criador com o mesmo runner é recusado", async () => {
    await assert.rejects(runServerTool(pkg("published"), "validate_package", input()), (e: unknown) => (e as { status?: number }).status === 400 && /indisponível/.test((e as Error).message));
  });

  it("entrada inválida vira 400 com o motivo (não 500)", async () => {
    await assert.rejects(runServerTool(pkg("agents"), "validate_package", { steps: [] }), (e: unknown) => (e as { status?: number }).status === 400 && /Entrada inválida/.test((e as Error).message));
  });
});

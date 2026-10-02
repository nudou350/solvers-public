import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  declaredTemplates,
  lookupTemplate,
  MAX_TEMPLATE_BYTES,
  readTemplateFile,
  renderTemplate,
  templateProblemText,
  templatesOverview,
  trialTemplateNames,
  visibleTemplates,
  type TemplateDecl,
} from "../src/runtime/templates.js";
import { PackagePathError } from "../src/runtime/package-paths.js";
import { trialAccessLine, trialLimits } from "../src/runtime/trial.js";
import { Manifest } from "../src/runtime/manifest.js";
import { ManifestV1 } from "../src/runtime/validate/schema-v1.js";

// Templates do pacote (PACKAGE_SPEC.md 7): só o declarado, só .md/.txt/.json, no teste só trial.templates. Sem env nem banco.

const root = mkdtempSync(join(tmpdir(), "solvers-tpl-"));
after(() => rmSync(root, { recursive: true, force: true }));

const md: TemplateDecl = { name: "briefing", path: "templates/briefing.md", title: "Briefing", description: "Modelo do briefing" };
const json: TemplateDecl = { name: "caso", path: "templates/caso.json", title: "Caso de eval", description: "Esqueleto de um caso" };
const svg: TemplateDecl = { name: "logo", path: "templates/logo.svg", title: "Logo", description: "Imagem" };
const html: TemplateDecl = { name: "pagina", path: "templates/pagina.html", title: "Página", description: "HTML" };
const decls = [md, json, svg, html];

describe("lookupTemplate", () => {
  it("acha o declarado pelo nome", () => {
    const r = lookupTemplate(decls, "briefing", null);
    assert.equal(r.ok && r.decl.path, "templates/briefing.md");
  });

  it("nada fora do declarado: nome desconhecido e pacote sem templates", () => {
    assert.deepEqual(lookupTemplate(decls, "segredo", null), { ok: false, reason: "unknown" });
    assert.deepEqual(lookupTemplate([], "briefing", null), { ok: false, reason: "none_declared" });
  });

  it("só .md, .txt e .json: svg e html declarados nunca são entregues", () => {
    assert.deepEqual(lookupTemplate(decls, "logo", null), { ok: false, reason: "type_not_allowed" });
    assert.deepEqual(lookupTemplate(decls, "pagina", null), { ok: false, reason: "type_not_allowed" });
    assert.equal(lookupTemplate(decls, "caso", null).ok, true);
    const txt = { ...md, name: "nota", path: "templates/NOTA.TXT" };
    assert.equal(lookupTemplate([txt], "nota", null).ok, true, "extensão em maiúsculas também vale");
  });

  it("no teste grátis, só os de trial.templates", () => {
    const trial = { templates: ["briefing"] };
    assert.equal(lookupTemplate(decls, "briefing", trial).ok, true);
    assert.deepEqual(lookupTemplate(decls, "caso", trial), { ok: false, reason: "not_in_trial" });
    // Teste sem nenhum template liberado (padrão): nenhum sai.
    assert.deepEqual(lookupTemplate(decls, "briefing", { templates: [] }), { ok: false, reason: "not_in_trial" });
  });
});

describe("textos para a IA", () => {
  it("o erro cita o que existe, e no teste só os liberados", () => {
    assert.match(templateProblemText("unknown", "x", [md, json]), /Disponíveis: briefing, caso/);
    assert.match(templateProblemText("not_in_trial", "caso", [md]), /não faz parte do teste grátis.*Liberados no teste: briefing/);
    assert.match(templateProblemText("none_declared", "x", []), /não tem templates/);
    assert.match(templateProblemText("type_not_allowed", "logo", []), /arquivo de texto/);
  });

  it("a visão geral lista os templates; no teste, só os liberados e quantos ficam para a licença", () => {
    const all = templatesOverview([md, json], null).join("\n");
    assert.match(all, /## Templates disponíveis \(peça o conteúdo com get_template\)/);
    assert.match(all, /- briefing: Briefing\. Modelo do briefing/);
    assert.match(all, /- caso: Caso de eval/);

    const trial = templatesOverview([md, json], { templates: ["briefing"] }).join("\n");
    assert.match(trial, /briefing/);
    assert.doesNotMatch(trial, /- caso:/);
    assert.match(trial, /mais 1 template só com a licença/);
  });

  it("sem templates (ou nenhum liberado e nenhum bloqueado) a seção some", () => {
    assert.deepEqual(templatesOverview([], null), []);
    assert.deepEqual(templatesOverview([], { templates: [] }), []);
  });

  it("visibleTemplates e os campos do manifesto", () => {
    assert.deepEqual(visibleTemplates(decls, null).length, 4);
    assert.deepEqual(visibleTemplates(decls, { templates: ["caso"] }), [json]);
    assert.deepEqual(declaredTemplates({}), []);
    assert.deepEqual(trialTemplateNames({}), []);
    assert.deepEqual(trialTemplateNames({ trial: { templates: ["a"] } }), ["a"]);
  });
});

describe("renderTemplate", () => {
  it("o conteúdo fica intacto, dentro de uma cerca, e a marca d'água vai fora dele", () => {
    const out = renderTemplate(json, '{ "id": "caso-1" }\n', "MARCA");
    assert.match(out, /^# Template: Caso de eval \(caso\)/);
    assert.ok(out.includes('```json\n{ "id": "caso-1" }\n```'));
    assert.ok(out.endsWith("MARCA"));
  });

  it("a cerca cresce quando o conteúdo já tem crases", () => {
    const out = renderTemplate(md, "antes\n```js\nx\n```\ndepois", "M");
    assert.ok(out.includes("````\nantes\n```js\nx\n```\ndepois\n````"));
  });
});

describe("readTemplateFile: disco", () => {
  const dir = join(root, "pkg");
  mkdirSync(join(dir, "templates"), { recursive: true });
  writeFileSync(join(dir, "templates", "briefing.md"), "# Briefing\n\nPreencha aqui.\n");
  writeFileSync(join(dir, "templates", "grande.md"), "x".repeat(MAX_TEMPLATE_BYTES + 1));
  writeFileSync(join(dir, "templates", "binario.md"), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
  writeFileSync(join(root, "segredo.md"), "SEGREDO");

  it("lê o arquivo do template", () => {
    assert.match(readTemplateFile(dir, md), /Preencha aqui/);
  });

  it("caminho do manifesto que escapa da pasta é recusado (package-paths)", () => {
    for (const path of ["../segredo.md", "templates/../../segredo.md", "/etc/passwd", "steps/01.md", "templates//briefing.md"]) {
      assert.throws(() => readTemplateFile(dir, { ...md, path }), PackagePathError, path);
    }
  });

  it("link simbólico dentro de templates/ é recusado (quando o sistema permite criar)", (t) => {
    try {
      symlinkSync(join(root, "segredo.md"), join(dir, "templates", "atalho.md"));
    } catch {
      t.skip("sem permissão para criar link simbólico neste sistema");
      return;
    }
    assert.throws(() => readTemplateFile(dir, { ...md, path: "templates/atalho.md" }), /link simbólico/);
  });

  it("arquivo grande demais e não UTF-8 não saem", () => {
    assert.throws(() => readTemplateFile(dir, { ...md, path: "templates/grande.md" }), /passa de/);
    assert.throws(() => readTemplateFile(dir, { ...md, path: "templates/binario.md" }));
  });
});

describe("trial.templates no manifesto", () => {
  const base = {
    id: "0123456789abcdef0123456789abcdef", slug: "meu-solver", name: "Meu Solver", tagline: "Uma frase de valor", description: "Descrição", category: "Outros", version: "1.0.0",
    creator: { id: "c", name: "C", bio: "b" }, requirements: [], packageContents: [], steps: [{ file: "steps/01.md", gate: [] }, { file: "steps/02.md", gate: [] }],
    pricing: { priceUsdc: 5, royaltyBps: 0 }, guarantee: { available: false, defaultCriteria: [] },
  };
  const trial = { uses: 1, steps: 1, searches: 1, tools: {}, summary: "Etapa 1 e um modelo.", lockedSummary: "O restante." };

  it("v1 mantém trial.templates; v0 (zod antigo) o descarta e o teste fica sem templates", () => {
    const v1 = ManifestV1.parse({ ...base, specVersion: 1, terms: { rightsConfirmed: true, sourcesListed: true }, templates: [md], trial: { ...trial, templates: ["briefing"] } });
    assert.deepEqual(trialLimits(v1 as never)!.templates, ["briefing"]);
    const v0 = Manifest.parse({ ...base, trial: { ...trial, templates: ["briefing"] } });
    assert.deepEqual(trialLimits(v0)!.templates, []);
  });

  it("a linha de acesso do teste lista os templates liberados (e só quando há)", () => {
    const withT = trialLimits({ trial: { available: true, uses: 3, steps: 1, searches: 1, tools: {}, toolLimits: {}, summary: "Etapa 1.", lockedSummary: "O resto.", templates: ["briefing"] } } as never)!;
    const noT = trialLimits({ trial: { available: true, uses: 3, steps: 1, searches: 1, tools: {}, toolLimits: {}, summary: "Etapa 1.", lockedSummary: "O resto." } } as never)!;
    assert.match(trialAccessLine(withT, { use: 1, totalSteps: 2, toolNames: [] }), /Templates liberados no teste \(get_template\): briefing/);
    assert.doesNotMatch(trialAccessLine(noT, { use: 1, totalSteps: 2, toolNames: [] }), /Templates liberados/);
  });
});

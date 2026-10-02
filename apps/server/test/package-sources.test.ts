import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadAll, loadPackage } from "../src/runtime/package-loader.js";

// Carregador com duas fontes (PACKAGE_SPEC.md 15.1): AGENTS_DIR (plataforma) e PUBLISHED_DIR (criadores). Mescla,
// colisão de id/slug, autoridade de `platform`, manifesto v1, hash sob demanda e reloadPackages().

const base = mkdtempSync(join(tmpdir(), "solvers-src-"));
after(() => rmSync(base, { recursive: true, force: true }));

const ID_PLATFORM = "c71ad0a50f750e75c71ad0a50f750e75";
const ID_A = "0123456789abcdef0123456789abcdef";
const ID_B = "fedcba9876543210fedcba9876543210";
const STEP = "# Etapa 1\n\nFaça o que for preciso.";

const v0 = (over: Record<string, unknown> = {}) => ({
  id: ID_A,
  slug: "meu-solver",
  name: "Meu Solver",
  tagline: "Uma frase de valor",
  description: "Descrição do solver",
  category: "Outros",
  version: "1.0.0",
  creator: { id: "c", name: "Criador", bio: "Bio" },
  requirements: [],
  packageContents: [],
  steps: [{ file: "steps/01-primeira.md", gate: [] }],
  pricing: { priceUsdc: 5, royaltyBps: 0 },
  guarantee: { available: false, defaultCriteria: [] },
  ...over,
});

const v1 = (over: Record<string, unknown> = {}) => ({
  ...v0(),
  specVersion: 1,
  terms: { rightsConfirmed: true, sourcesListed: true },
  versions: [{ version: "1.0.0", releasedAt: "2026-10-01", notes: "n" }],
  searchPhrases: [],
  beforeAfter: [],
  templates: [{ name: "briefing", path: "templates/briefing.md", title: "Briefing", description: "Modelo" }],
  steps: [{ file: "steps/01-primeira.md", gate: ["Item simples", { text: "Item com prova", evidence: { tool: "validate_package" } }] }],
  tools: [{ name: "validate_package", description: "Valida", runner: "builtin:validate-package" }],
  ...over,
});

/** Cria `<root>/<folder>` com manifesto, uma etapa e arquivos extras. */
function pkg(root: string, folder: string, manifest: Record<string, unknown>, extra: Record<string, string> = {}) {
  const dir = join(root, folder);
  mkdirSync(join(dir, "steps"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "steps", "01-primeira.md"), STEP);
  for (const [rel, content] of Object.entries(extra)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

let n = 0;
const fresh = () => {
  const root = join(base, `case-${++n}`);
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, "published"), { recursive: true });
  return { agents: join(root, "agents"), published: join(root, "published") };
};

describe("mescla das duas fontes", () => {
  it("plataforma e criadores entram no mesmo mapa, por id e por slug, marcando a origem", () => {
    const d = fresh();
    pkg(d.agents, "frontend-react", v0({ id: ID_A, slug: "frontend-react" }));
    pkg(d.published, "do-criador", v1({ id: ID_B, slug: "do-criador" }), { "templates/briefing.md": "# B" });
    const errors: string[] = [];
    const onError = (dir: string, e: Error) => errors.push(`${dir}: ${e.message}`);
    const reg = loadAll(d.agents, onError, { source: "agents" });
    loadAll(d.published, onError, { source: "published", into: reg });
    assert.deepEqual(errors, []);
    assert.equal(reg.get("frontend-react")?.source, "agents");
    assert.equal(reg.get(ID_B)?.source, "published");
    assert.equal(reg.get("do-criador"), reg.get(ID_B));
    assert.equal(new Set([...reg.values()]).size, 2);
  });

  it("PUBLISHED_DIR inexistente não é erro", () => {
    const d = fresh();
    pkg(d.agents, "frontend-react", v0({ slug: "frontend-react" }));
    const errors: string[] = [];
    const reg = loadAll(d.agents, (dir, e) => errors.push(e.message), { source: "agents" });
    loadAll(join(d.published, "nao-existe"), (dir, e) => errors.push(e.message), { source: "published", into: reg });
    assert.deepEqual(errors, []);
    assert.equal(reg.size, 2);
  });

  it("id duplicado entre as fontes FALHA o pacote do criador e a plataforma continua", () => {
    const d = fresh();
    pkg(d.agents, "frontend-react", v0({ id: ID_A, slug: "frontend-react" }));
    pkg(d.published, "copia", v1({ id: ID_A, slug: "copia" }), { "templates/briefing.md": "# B" });
    const errors: string[] = [];
    const reg = loadAll(d.agents, (dir, e) => errors.push(e.message), { source: "agents" });
    loadAll(d.published, (dir, e) => errors.push(e.message), { source: "published", into: reg });
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /já pertence ao pacote frontend-react/);
    assert.equal(reg.get(ID_A)?.manifest.slug, "frontend-react");
    assert.equal(reg.has("copia"), false);
  });

  it("slug duplicado entre as fontes também falha", () => {
    const d = fresh();
    pkg(d.agents, "frontend-react", v0({ id: ID_A, slug: "frontend-react" }));
    pkg(d.published, "frontend-react", v1({ id: ID_B, slug: "frontend-react" }), { "templates/briefing.md": "# B" });
    const errors: string[] = [];
    const reg = loadAll(d.agents, (dir, e) => errors.push(e.message), { source: "agents" });
    loadAll(d.published, (dir, e) => errors.push(e.message), { source: "published", into: reg });
    assert.match(errors.join(), /"frontend-react" já pertence/);
    assert.equal(reg.get("frontend-react")?.source, "agents");
  });

  it("_archive/, pastas ocultas e node_modules não são pacotes", () => {
    const d = fresh();
    pkg(d.published, "_archive", v1({ id: ID_B, slug: "arquivado" }));
    pkg(d.published, ".tmp-123", v1({ id: ID_A, slug: "em-troca" }));
    pkg(d.published, "node_modules", v1({ id: ID_PLATFORM, slug: "x-modulo" }));
    const errors: string[] = [];
    const reg = loadAll(d.published, (dir, e) => errors.push(e.message), { source: "published" });
    assert.equal(reg.size, 0);
    assert.deepEqual(errors, []);
  });

  it("pacote publicado em pasta com outro nome que o slug é recusado", () => {
    const d = fresh();
    pkg(d.published, "outra-pasta", v1({ id: ID_B, slug: "do-criador" }), { "templates/briefing.md": "# B" });
    const errors: string[] = [];
    loadAll(d.published, (dir, e) => errors.push(e.message), { source: "published" });
    assert.match(errors.join(), /não é o slug do pacote/);
  });
});

describe("autoridade de platform (lista do servidor)", () => {
  it("o Criador na pasta da plataforma carrega como platform; o manifesto v1 mantém os campos novos", () => {
    const d = fresh();
    pkg(d.agents, "criador-de-solvers", v1({ id: ID_PLATFORM, slug: "criador-de-solvers", platform: true }), { "templates/briefing.md": "# B" });
    const reg = loadAll(d.agents, (dir, e) => assert.fail(e.message), { source: "agents" });
    const p = reg.get("criador-de-solvers")!;
    assert.equal(p.platform, true);
    assert.equal(p.manifest.specVersion, 1);
    assert.equal(p.manifest.platform, true);
    assert.deepEqual(p.manifest.templates?.map((t) => t.name), ["briefing"]);
    // Gate com evidência vira texto para o motor de etapas.
    assert.deepEqual(p.steps[0]!.gate, ["Item simples", "Item com prova"]);
  });

  it("pacote comum não é platform; platform: true de pacote comum é recusado (na plataforma e em criador)", () => {
    const d = fresh();
    pkg(d.agents, "frontend-react", v0({ slug: "frontend-react" }));
    assert.equal(loadAll(d.agents, () => undefined, { source: "agents" }).get("frontend-react")!.platform, false);

    const d2 = fresh();
    pkg(d2.agents, "esperto", v1({ id: ID_B, slug: "esperto", platform: true }), { "templates/briefing.md": "# B" });
    pkg(d2.published, "esperto-2", v1({ id: ID_A, slug: "esperto-2", platform: true }), { "templates/briefing.md": "# B" });
    const errors: string[] = [];
    const reg = loadAll(d2.agents, (dir, e) => errors.push(e.message), { source: "agents" });
    loadAll(d2.published, (dir, e) => errors.push(e.message), { source: "published", into: reg });
    assert.equal(reg.size, 0);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((m) => /não está em PLATFORM_AGENTS/.test(m)));
  });

  it("criador não pode publicar com o slug nem com o id do Criador de Solvers", () => {
    const d = fresh();
    pkg(d.published, "criador-de-solvers", v1({ id: ID_B, slug: "criador-de-solvers" }), { "templates/briefing.md": "# B" });
    pkg(d.published, "outro", v1({ id: ID_PLATFORM, slug: "outro" }), { "templates/briefing.md": "# B" });
    const errors: string[] = [];
    const reg = loadAll(d.published, (dir, e) => errors.push(e.message), { source: "published" });
    assert.equal(reg.size, 0);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((m) => /reservado/.test(m)));
  });
});

describe("manifesto v1 e v0 no carregador", () => {
  it("v1 estrito: campo desconhecido não carrega; v1 sem id não carrega", () => {
    const d = fresh();
    const dir = pkg(d.published, "do-criador", v1({ id: ID_B, slug: "do-criador", inventado: true }), { "templates/briefing.md": "# B" });
    assert.throws(() => loadPackage(dir, { source: "published" }), /Unrecognized key/);
    const dir2 = pkg(d.published, "sem-id", { ...v1({ slug: "sem-id" }), id: undefined }, { "templates/briefing.md": "# B" });
    assert.throws(() => loadPackage(dir2, { source: "published" }), /sem id/);
  });

  it("v0 continua como antes: sem specVersion, sem templates", () => {
    const d = fresh();
    const p = loadPackage(pkg(d.agents, "meu-solver", v0()));
    assert.equal(p.manifest.specVersion, undefined);
    assert.equal(p.platform, false);
    assert.equal(p.source, "agents");
  });
});

describe("hash de versão sob demanda", () => {
  it("o carregamento não lê o pacote inteiro: o hash só é calculado no primeiro uso e depois fica fixo", () => {
    const d = fresh();
    const dir = pkg(d.agents, "meu-solver", v0(), { "knowledge/a.md": "versão 1" });
    const p = loadPackage(dir);
    // Mexe no conhecimento DEPOIS de carregar: se o hash já tivesse sido calculado, ele ignoraria a mudança.
    writeFileSync(join(dir, "knowledge", "a.md"), "versão 2");
    const first = p.versionHash;
    assert.match(first, /^[0-9a-f]{64}$/);
    const other = loadPackage(dir).versionHash;
    assert.equal(first, other, "o primeiro cálculo já via a versão 2");
    writeFileSync(join(dir, "knowledge", "a.md"), "versão 3");
    assert.equal(p.versionHash, first, "depois de calculado, não muda");
  });
});

describe("packages() e reloadPackages()", () => {
  const dirs = fresh();
  let mod: typeof import("../src/runtime/packages.js");

  before(async () => {
    pkg(dirs.agents, "frontend-react", v0({ slug: "frontend-react" }));
    // O env do servidor exige estas variáveis; valores de mentira bastam.
    Object.assign(process.env, {
      AGENTS_DIR: dirs.agents,
      PUBLISHED_DIR: dirs.published,
      USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      FEE_PAYER_KEYPAIR: process.env.FEE_PAYER_KEYPAIR ?? "x",
      VERIFIER_KEYPAIR: process.env.VERIFIER_KEYPAIR ?? "x",
      USAGE_AUTHORITY_KEYPAIR: process.env.USAGE_AUTHORITY_KEYPAIR ?? "x",
      JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
      SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
    });
    mod = await import("../src/runtime/packages.js");
  });

  it("mescla as duas pastas e reloadPackages() enxerga o que foi publicado depois", () => {
    const first = mod.packages();
    assert.equal(mod.getPackage("frontend-react")?.source, "agents");
    assert.equal(mod.getPackage("do-criador"), undefined);
    assert.equal(mod.packages(), first, "cache: o mesmo mapa enquanto ninguém recarrega");

    pkg(dirs.published, "do-criador", v1({ id: ID_B, slug: "do-criador" }), { "templates/briefing.md": "# B" });
    assert.equal(mod.getPackage("do-criador"), undefined, "sem recarregar, o cache segue valendo");
    const reloaded = mod.reloadPackages();
    assert.notEqual(reloaded, first);
    assert.equal(mod.getPackage("do-criador")?.source, "published");
    assert.equal(mod.getPackage(ID_B)?.manifest.slug, "do-criador");
    assert.equal(mod.packages(), reloaded);
  });

  it("depois de despublicar (pasta removida), reloadPackages() tira o pacote", () => {
    rmSync(join(dirs.published, "do-criador"), { recursive: true, force: true });
    mod.reloadPackages();
    assert.equal(mod.getPackage("do-criador"), undefined);
  });

  it("packageLoadErrors() lista o pacote recusado, e a plataforma vence a colisão", () => {
    pkg(dirs.published, "copia", v1({ id: ID_A, slug: "copia" }), { "templates/briefing.md": "# B" });
    mod.reloadPackages();
    const errs = mod.packageLoadErrors();
    assert.equal(errs.length, 1);
    assert.match(errs[0]!.message, /já pertence ao pacote frontend-react/);
    assert.equal(mod.getPackage(ID_A)?.manifest.slug, "frontend-react");
  });
});

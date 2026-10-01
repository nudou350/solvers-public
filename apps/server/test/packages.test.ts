import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { Manifest } from "../src/runtime/manifest.js";
import { loadAll, loadPackage, registerPackage, type SolverPackage } from "../src/runtime/package-loader.js";
import { PackagePathError, resolveInsidePackage } from "../src/runtime/package-paths.js";

// Carregador de pacotes: contenção de caminhos do manifesto, formato de slug/versão e colisão de id/slug
// (PACKAGE_SPEC.md 3.3, 4.1 e P0). Sem env, banco ou rede.

const root = mkdtempSync(join(tmpdir(), "solvers-pkg-"));
after(() => rmSync(root, { recursive: true, force: true }));

const ID_A = "0123456789abcdef0123456789abcdef";
const ID_B = "fedcba9876543210fedcba9876543210";

function manifestJson(over: Record<string, unknown> = {}) {
  return {
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
  };
}

let n = 0;
/** Cria uma pasta de pacote em disco e devolve o caminho. */
function writePackage(manifest: Record<string, unknown>, files: Record<string, string> = { "steps/01-primeira.md": "# Etapa 1\n\nFaça o que for preciso." }) {
  const dir = join(root, `pkg-${++n}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("resolveInsidePackage", () => {
  const dir = writePackage(manifestJson(), { "steps/01-primeira.md": "ok", "steps/sub/02.md": "ok", "knowledge/a.md": "conhecimento" });
  const STEPS = ["steps/"];

  it("aceita arquivo dentro de steps/", () => {
    assert.match(resolveInsidePackage(dir, "steps/01-primeira.md", STEPS), /01-primeira\.md$/);
    assert.match(resolveInsidePackage(dir, "steps/sub/02.md", STEPS), /02\.md$/);
  });

  it("recusa ../ e variações (sair da pasta do pacote)", () => {
    for (const rel of ["../manifest.json", "steps/../manifest.json", "steps/../../x", "../../../etc/passwd", "steps/./01-primeira.md", "steps//01-primeira.md", "steps/"]) {
      assert.throws(() => resolveInsidePackage(dir, rel, STEPS), PackagePathError, rel);
    }
  });

  it("recusa caminho absoluto, unidade do Windows, barra invertida e controle", () => {
    for (const rel of ["/etc/passwd", "C:/Windows/win.ini", "C:\\x.md", "steps\\01-primeira.md", "steps/01\u0000.md", "steps/01\n.md", ""]) {
      assert.throws(() => resolveInsidePackage(dir, rel, STEPS), PackagePathError, JSON.stringify(rel));
    }
  });

  it("recusa prefixo fora do permitido e arquivo inexistente", () => {
    assert.throws(() => resolveInsidePackage(dir, "knowledge/a.md", STEPS), /começar por steps\//);
    assert.throws(() => resolveInsidePackage(dir, "steps/nao-existe.md", STEPS), /não existe/);
    assert.throws(() => resolveInsidePackage(dir, "x".repeat(300), STEPS), /longo/);
  });

  it("recusa link simbólico apontando para fora (quando o sistema permite criar)", (t) => {
    const outside = join(root, "segredo.env");
    writeFileSync(outside, "SERVER_KEK=segredo");
    try {
      symlinkSync(outside, join(dir, "steps", "link.md"));
    } catch {
      t.skip("sem permissão para criar link simbólico neste sistema");
      return;
    }
    assert.throws(() => resolveInsidePackage(dir, "steps/link.md", STEPS), /link simbólico/);
  });
});

describe("resolveInsidePackage: diretório-link (junction no Windows, symlink no Linux)", () => {
  it("steps/link/arquivo.md apontando para fora é recusado", (t) => {
    const dir = writePackage(manifestJson());
    const outsideDir = join(root, "fora-dir");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "segredo.md"), "SERVER_KEK=segredo");
    try {
      symlinkSync(outsideDir, join(dir, "steps", "atalho"), "junction");
    } catch {
      t.skip("não foi possível criar link de diretório neste sistema");
      return;
    }
    assert.throws(() => resolveInsidePackage(dir, "steps/atalho/segredo.md", ["steps/"]), /link simbólico/);
  });
});

describe("loadPackage: manifesto malicioso", () => {
  it("steps[].file com ../ não entrega o arquivo de fora como etapa", () => {
    const dir = writePackage(manifestJson({ steps: [{ file: "../segredo.env", gate: [] }] }));
    writeFileSync(join(root, "segredo.env"), "SERVER_KEK=segredo");
    assert.throws(() => loadPackage(dir), PackagePathError);
  });

  it("steps[].file fora de steps/ é recusado mesmo existindo", () => {
    const dir = writePackage(manifestJson({ steps: [{ file: "knowledge/a.md", gate: [] }] }), { "knowledge/a.md": "texto", "steps/01-primeira.md": "x" });
    assert.throws(() => loadPackage(dir), /começar por steps\//);
  });

  it("pacote com link simbólico não carrega (nem entra no hash)", (t) => {
    const dir = writePackage(manifestJson());
    const outside = join(root, "fora.txt");
    writeFileSync(outside, "conteúdo de fora");
    try {
      symlinkSync(outside, join(dir, "knowledge-link.txt"));
    } catch {
      t.skip("sem permissão para criar link simbólico neste sistema");
      return;
    }
    assert.throws(() => loadPackage(dir), /link simbólico/);
  });

  it("pacote válido carrega e usa a etapa de dentro da pasta", () => {
    const pkg = loadPackage(writePackage(manifestJson()));
    assert.equal(pkg.steps[0]!.title, "Etapa 1");
    assert.equal(pkg.manifest.slug, "meu-solver");
    assert.match(pkg.versionHash, /^[0-9a-f]{64}$/);
  });
});

describe("Manifest: slug e versão", () => {
  const parse = (over: Record<string, unknown>) => Manifest.safeParse(manifestJson(over));

  it("slugs válidos", () => {
    for (const slug of ["frontend-react", "abc", "a1-b2-c3", "x".repeat(40)]) assert.equal(parse({ slug }).success, true, slug);
  });

  it("recusa slug com formato inválido", () => {
    for (const slug of ["", "ab", "Maiuscula", "com espaço", "com_underline", "-começa", "termina-", "duplo--hífen", "../x", "a/b", "ação", "x".repeat(41)]) {
      assert.equal(parse({ slug }).success, false, JSON.stringify(slug));
    }
  });

  it("recusa slug com formato de id (32 hex): sequestraria a busca de outro agente", () => {
    const r = parse({ slug: ID_B });
    assert.equal(r.success, false);
    assert.match(JSON.stringify(r.error?.issues), /formato de um id/);
  });

  it("versões válidas e inválidas", () => {
    for (const version of ["1.0.0", "0.9.0", "10.20.30"]) assert.equal(parse({ version }).success, true, version);
    for (const version of ["1.0", "v1.0.0", "1.0.0-beta", "1.0.0+build", "1.0.x", "", "../1.0.0", "1234567890.1234567890.1"]) {
      assert.equal(parse({ version }).success, false, version);
    }
  });
});

/** SolverPackage mínimo só para o mapa de registro. */
const fakePkg = (id: string, slug: string): SolverPackage => ({ manifest: { id, slug } as never, dir: "/x", steps: [], versionHash: "", evalReport: null, usesMemory: false });

describe("registerPackage: id e slug são um só espaço de nomes", () => {
  it("registra por id e por slug", () => {
    const reg = new Map<string, SolverPackage>();
    const p = fakePkg(ID_A, "meu-solver");
    registerPackage(reg, p);
    assert.equal(reg.get(ID_A), p);
    assert.equal(reg.get("meu-solver"), p);
  });

  it("id repetido é recusado e o primeiro continua", () => {
    const reg = new Map<string, SolverPackage>();
    const first = fakePkg(ID_A, "primeiro");
    registerPackage(reg, first);
    assert.throws(() => registerPackage(reg, fakePkg(ID_A, "segundo")), /já pertence/);
    assert.equal(reg.get(ID_A), first);
    assert.equal(reg.has("segundo"), false);
  });

  it("slug repetido é recusado", () => {
    const reg = new Map<string, SolverPackage>();
    registerPackage(reg, fakePkg(ID_A, "mesmo"));
    assert.throws(() => registerPackage(reg, fakePkg(ID_B, "mesmo")), /já pertence/);
    assert.equal(reg.has(ID_B), false);
  });

  it("slug de um igual ao id de outro é recusado (defesa, mesmo que o Manifest já bloqueie)", () => {
    const reg = new Map<string, SolverPackage>();
    registerPackage(reg, fakePkg(ID_A, "original"));
    assert.throws(() => registerPackage(reg, fakePkg(ID_B, ID_A)), /já pertence/);
    assert.equal(reg.get(ID_A)?.manifest.slug, "original");
  });
});

describe("loadAll", () => {
  it("duplicata: o primeiro por ordem alfabética fica, o outro é recusado e reportado", () => {
    const base = mkdtempSync(join(tmpdir(), "solvers-all-"));
    try {
      for (const [folder, slug] of [["a-primeiro", "primeiro"], ["b-copia", "copia"]] as const) {
        const d = join(base, folder);
        mkdirSync(join(d, "steps"), { recursive: true });
        writeFileSync(join(d, "manifest.json"), JSON.stringify(manifestJson({ slug })));
        writeFileSync(join(d, "steps", "01-primeira.md"), "# Etapa");
      }
      const errors: string[] = [];
      const reg = loadAll(base, (dir, e) => errors.push(`${dir}: ${e.message}`));
      assert.equal(reg.get(ID_A)?.manifest.slug, "primeiro");
      assert.equal(reg.has("copia"), false);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /b-copia.*já pertence/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("os pacotes reais do repositório carregam sem erro (regressão das regras novas)", () => {
    const errors: string[] = [];
    const reg = loadAll(resolve(import.meta.dirname, "../../../agents"), (dir, e) => errors.push(`${dir}: ${e.message}`));
    assert.deepEqual(errors, []);
    const ids = new Set([...reg.values()].map((p) => p.manifest.id));
    assert.ok(ids.size >= 8, `esperava 8 pacotes, achei ${ids.size}`);
  });
});

import { strict as assert } from "node:assert";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { packageHashOf } from "../src/review/hash.js";
import { packageHash } from "../src/runtime/package-loader.js";
import { packageFromFolder, packageFromMemory } from "../src/runtime/validate/input.js";
import { baseFiles } from "./validate-fixtures.js";

// O hash do PackageInput precisa ser IDÊNTICO ao do carregador do disco (o que o `cli:publish` grava on-chain como versionHash).

const agents = resolve(import.meta.dirname, "../../../agents");
const SLUGS = ["backend-node", "copy-marketing", "financas-pessoais", "frontend-react", "planejador-viagens", "planilhas-dados", "revisao-contratos", "ui-design"];

describe("packageHashOf = packageHash(dir) nos pacotes de agents/", () => {
  for (const slug of SLUGS) {
    it(`${slug}`, () => {
      const dir = resolve(agents, slug);
      assert.equal(packageHashOf(packageFromFolder(dir)), packageHash(dir));
    });
  }

  it("com CRLF no checkout o hash é o mesmo (texto normalizado)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "solvers-hash-"));
    try {
      const dir = join(tmp, "backend-node");
      cpSync(resolve(agents, "backend-node"), dir, { recursive: true });
      const manifest = join(dir, "manifest.json");
      writeFileSync(manifest, readFileSync(manifest, "utf8").replace(/\r?\n/g, "\r\n"));
      assert.equal(packageHashOf(packageFromFolder(dir)), packageHash(resolve(agents, "backend-node")));
      assert.equal(packageHash(dir), packageHash(resolve(agents, "backend-node")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("packageHashOf em memória", () => {
  it("é determinístico e independe da ordem das entradas", () => {
    const a = packageFromMemory(baseFiles());
    const b = { entries: [...a.entries].reverse(), read: a.read };
    assert.equal(packageHashOf(a), packageHashOf(b));
    assert.match(packageHashOf(a), /^[0-9a-f]{64}$/);
  });

  it("CRLF x LF em texto dá o mesmo hash; um byte diferente muda", () => {
    const f = baseFiles();
    const g = { ...f, "steps/01-levantar.md": (f["steps/01-levantar.md"] as string).replace(/\n/g, "\r\n") };
    assert.equal(packageHashOf(packageFromMemory(f)), packageHashOf(packageFromMemory(g)));
    const h = { ...f, "steps/01-levantar.md": `${f["steps/01-levantar.md"] as string}.` };
    assert.notEqual(packageHashOf(packageFromMemory(f)), packageHashOf(packageFromMemory(h)));
  });

  it("não entram evals/report.json, node_modules nem nomes com ponto", () => {
    const f = baseFiles();
    const base = packageHashOf(packageFromMemory(f));
    const g = { ...f, "evals/report.json": '{"scoreBps": 9000}', ".DS_Store": "x", "knowledge/.oculto.md": "x", "node_modules/x/a.js": "x" };
    assert.equal(packageHashOf(packageFromMemory(g)), base);
  });

  it("o caminho entra no hash (renomear muda) e binário não é normalizado", () => {
    const f = baseFiles();
    const { "knowledge/das-mei-2026.md": md, ...rest } = f;
    assert.notEqual(packageHashOf(packageFromMemory(f)), packageHashOf(packageFromMemory({ ...rest, "knowledge/outro-nome.md": md! })));
    const x = packageHashOf(packageFromMemory({ ...f, "templates/a.png": new Uint8Array([13, 10]) }));
    const y = packageHashOf(packageFromMemory({ ...f, "templates/a.png": new Uint8Array([10]) }));
    assert.notEqual(x, y);
  });

  it("link simbólico e arquivo ausente são recusados", () => {
    const a = packageFromMemory(baseFiles());
    assert.throws(() => packageHashOf({ entries: [...a.entries, { path: "knowledge/l.md", size: 0, isSymlink: true }], read: a.read }), /link simbólico/);
    assert.throws(() => packageHashOf({ entries: [...a.entries, { path: "knowledge/falta.md", size: 1 }], read: a.read }), /ausente/);
  });
});

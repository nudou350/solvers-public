import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { cleanIncoming, findPackageRoot, incomingParent, publishedVersionOf, stagePackage, swapInPublished } from "../src/publish/fs.js";

// Disco da publicação (PACKAGE_SPEC.md 15.1): achar a raiz do pacote extraído, copiar para a pasta de preparo e trocar a
// pasta publicada por rename, arquivando a versão anterior. Só node:fs, em pasta temporária.

const base = mkdtempSync(join(tmpdir(), "solvers-pubfs-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
function pkg(version: string, extra: Record<string, string> = {}) {
  const dir = join(base, `src-${++n}`);
  mkdirSync(join(dir, "steps"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ slug: "meu-solver", version }));
  writeFileSync(join(dir, "steps", "01.md"), `etapa ${version}`);
  for (const [rel, content] of Object.entries(extra)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("findPackageRoot", () => {
  it("a própria pasta, quando tem manifest.json", () => {
    const dir = pkg("1.0.0");
    assert.equal(findPackageRoot(dir), dir);
  });

  it("a única subpasta com manifest.json (raiz do ZIP), ignorando __MACOSX e ocultos", () => {
    const outer = join(base, `outer-${++n}`);
    mkdirSync(join(outer, "__MACOSX"), { recursive: true });
    mkdirSync(join(outer, ".git"), { recursive: true });
    mkdirSync(join(outer, "meu-solver"), { recursive: true });
    writeFileSync(join(outer, "meu-solver", "manifest.json"), "{}");
    assert.equal(findPackageRoot(outer), join(outer, "meu-solver"));
  });

  it("falha sem manifest.json, com dois candidatos ou sem a pasta", () => {
    const empty = join(base, `empty-${++n}`);
    mkdirSync(empty);
    assert.throws(() => findPackageRoot(empty), /manifest\.json/);
    const two = join(base, `two-${++n}`);
    for (const d of ["a", "b"]) {
      mkdirSync(join(two, d), { recursive: true });
      writeFileSync(join(two, d, "manifest.json"), "{}");
    }
    assert.throws(() => findPackageRoot(two), /2 candidatos/);
    assert.throws(() => findPackageRoot(join(base, "nao-existe")), /não encontrada/);
  });
});

describe("stagePackage e swapInPublished", () => {
  it("a primeira publicação: copia para <preparo>/<slug> e coloca em <publicados>/<slug> sem arquivar nada", () => {
    const published = join(base, `pub-${++n}`);
    const src = pkg("1.0.0", { "knowledge/a.md": "conteúdo" });
    const staged = stagePackage(src, incomingParent(published, "sub1"), "meu-solver");
    assert.equal(staged, join(published, ".incoming", "sub1", "meu-solver"));
    const { archivedTo } = swapInPublished(published, "meu-solver", staged);
    assert.equal(archivedTo, null);
    assert.equal(readFileSync(join(published, "meu-solver", "knowledge", "a.md"), "utf8"), "conteúdo");
    assert.equal(existsSync(staged), false, "o preparo foi movido, não copiado");
    assert.equal(existsSync(src), true, "a pasta extraída original fica (a submissão guarda)");
  });

  it("a atualização arquiva a anterior em _archive/<slug>/<version>/ e o novo vira o ativo", () => {
    const published = join(base, `pub-${++n}`);
    swapInPublished(published, "meu-solver", stagePackage(pkg("1.0.0"), incomingParent(published, "s1"), "meu-solver"));
    const { archivedTo } = swapInPublished(published, "meu-solver", stagePackage(pkg("1.1.0"), incomingParent(published, "s2"), "meu-solver"));
    assert.equal(archivedTo, join(published, "_archive", "meu-solver", "1.0.0"));
    assert.equal(publishedVersionOf(join(published, "meu-solver")), "1.1.0");
    assert.equal(publishedVersionOf(archivedTo!), "1.0.0");
  });

  it("nunca sobrescreve uma versão já arquivada (mesma versão republicada ganha sufixo)", () => {
    const published = join(base, `pub-${++n}`);
    swapInPublished(published, "meu-solver", stagePackage(pkg("1.0.0"), incomingParent(published, "s1"), "meu-solver"));
    swapInPublished(published, "meu-solver", stagePackage(pkg("1.0.0", { "extra.md": "x" }), incomingParent(published, "s2"), "meu-solver"));
    const { archivedTo } = swapInPublished(published, "meu-solver", stagePackage(pkg("1.0.0", { "extra2.md": "y" }), incomingParent(published, "s3"), "meu-solver"));
    assert.equal(archivedTo, join(published, "_archive", "meu-solver", "1.0.0-1"));
    assert.equal(existsSync(join(published, "_archive", "meu-solver", "1.0.0", "manifest.json")), true);
  });

  it("refazer o preparo apaga a cópia anterior; cleanIncoming limpa tudo", () => {
    const published = join(base, `pub-${++n}`);
    const parent = incomingParent(published, "s1");
    stagePackage(pkg("1.0.0", { "velho.md": "x" }), parent, "meu-solver");
    const again = stagePackage(pkg("1.0.0"), parent, "meu-solver");
    assert.equal(existsSync(join(again, "velho.md")), false);
    cleanIncoming(published, "s1");
    assert.equal(existsSync(parent), false);
  });

  it("publishedVersionOf: null para pasta sem manifesto legível", () => {
    assert.equal(publishedVersionOf(join(base, "nao-existe")), null);
    const bad = join(base, `bad-${++n}`);
    mkdirSync(bad);
    writeFileSync(join(bad, "manifest.json"), "{ não é json");
    assert.equal(publishedVersionOf(bad), null);
  });
});

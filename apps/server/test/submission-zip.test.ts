import { strict as assert } from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { extractZip, NUCLEO_ZIP_LIMITS, ZipError, type ZipLimits } from "../src/submissions/zip.js";
import { buildZip, type ZipSpec } from "./helpers/zip-builder.js";

// Extração segura de ZIP (PACKAGE_SPEC.md 3.2) com ZIPs maliciosos montados à mão. Sem banco nem rede.

describe("extractZip", () => {
  let tmp: string;
  let n = 0;
  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), "solvers-zip-"));
  });
  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const run = async (specs: ZipSpec[], limits: Partial<ZipLimits> = {}) => {
    const zip = join(tmp, `z${n}.zip`);
    const dest = join(tmp, `out${n++}`);
    await writeFile(zip, buildZip(specs));
    return { dest, result: extractZip(zip, dest, { ...NUCLEO_ZIP_LIMITS, ...limits }) };
  };
  const codes = async (p: Promise<unknown>): Promise<string[]> => {
    try {
      await p;
    } catch (e) {
      assert.ok(e instanceof ZipError, `esperava ZipError, veio ${String(e)}`);
      return e.issues.map((i) => i.code);
    }
    return [];
  };

  const base: ZipSpec[] = [
    { name: "pkg/manifest.json", data: "{}" },
    { name: "pkg/steps/01-a.md", data: "# Etapa\n" },
  ];

  it("extrai pelo diretório central, com a raiz achatada e tamanhos reais", async () => {
    const { dest, result } = await run([...base, { name: "pkg/knowledge/ação.md", data: "conteúdo" }, { name: "pkg/steps/", data: "" }]);
    const r = await result;
    assert.equal(r.rootName, "pkg");
    assert.equal(r.root, dest);
    assert.deepEqual(r.entries.map((e) => e.path).sort(), ["knowledge/ação.md", "manifest.json", "steps/01-a.md"]);
    assert.equal(readFileSync(join(dest, "manifest.json"), "utf8"), "{}");
    assert.equal(r.entries.find((e) => e.path === "manifest.json")!.size, 2);
    assert.equal(r.expandedBytes, 2 + Buffer.byteLength("# Etapa\n") + Buffer.byteLength("conteúdo"), "soma dos bytes reais");
    if (process.platform !== "win32") assert.equal(statSync(join(dest, "manifest.json")).mode & 0o111, 0, "sem permissão de execução");
  });

  it("normaliza nomes em NFC (o Finder grava NFD)", async () => {
    const nfd = "pkg/steps/a\u0303o.md"; // "ão" decomposto
    const { dest, result } = await run([...base, { name: nfd, data: "x" }]);
    const r = await result;
    assert.ok(r.entries.some((e) => e.path === "steps/ão.md"), "caminho devolvido em NFC");
    assert.ok(existsSync(join(dest, "steps", "ão.md")));
  });

  it("remove lixo de sistema com aviso (e não recusa o ZIP)", async () => {
    const { dest, result } = await run([...base, { name: "__MACOSX/pkg/._manifest.json", data: "x" }, { name: "__MACOSX/pkg/._a", data: "x" }, { name: "pkg/.DS_Store", data: "x" }, { name: "pkg/steps/Thumbs.db", data: "x" }]);
    const r = await result;
    assert.deepEqual(r.warnings.map((w) => w.code), ["ZIP_IGNORED_FILE", "ZIP_IGNORED_FILE", "ZIP_IGNORED_FILE"]);
    assert.equal(r.entries.length, 2);
    assert.ok(!existsSync(join(dest, ".DS_Store")));
  });

  it("zip-slip: .., absoluto, barra invertida e unidade são recusados e nada é gravado fora", async () => {
    for (const bad of ["pkg/../../evil.md", "../evil.md", "/etc/evil.md", "pkg/..\\..\\evil.md", "C:/evil.md", "pkg/steps/../../../evil.md", "pkg/./a.md", "pkg//a.md"]) {
      const { dest, result } = await run([...base, { name: bad, data: "pwn" }]);
      const found = await codes(result);
      assert.ok(found.includes("ZIP_BAD_PATH"), `${bad} -> ${found.join(",")}`);
      assert.ok(!existsSync(dest), "pasta de destino não fica para trás");
    }
    assert.ok(!existsSync(join(tmp, "evil.md")) && !existsSync(join(tmp, "..", "evil.md")));
  });

  it("recusa controle, nome iniciando em ponto, caracteres estranhos e nome que não é UTF-8", async () => {
    for (const bad of ["pkg/a\u0001.md", "pkg/.env.md", "pkg/steps/.oculto.md", "pkg/a:b.md", "pkg/a*.md", "pkg/fim. .md "]) {
      const found = await codes((await run([...base, { name: bad, data: "x" }])).result);
      assert.ok(found.includes("ZIP_BAD_PATH"), `${bad} -> ${found.join(",")}`);
    }
    const found = await codes((await run([...base, { name: "x", rawName: Buffer.from([0x70, 0x6b, 0x67, 0x2f, 0xff, 0xfe, 0x2e, 0x6d, 0x64]), data: "x" }])).result);
    assert.ok(found.includes("ZIP_BAD_PATH"));
  });

  it("recusa duplicados (NFC e maiúsculas)", async () => {
    assert.ok((await codes((await run([...base, { name: "pkg/steps/01-A.md", data: "x" }])).result)).includes("ZIP_DUPLICATE_ENTRY"));
    assert.ok((await codes((await run([...base, { name: "pkg/steps/\u00e3.md", data: "x" }, { name: "pkg/steps/a\u0303.md", data: "y" }])).result)).includes("ZIP_DUPLICATE_ENTRY"));
    assert.ok((await codes((await run([...base, { name: "pkg/manifest.json", data: "outro" }])).result)).includes("ZIP_DUPLICATE_ENTRY"));
  });

  it("recusa link simbólico", async () => {
    const found = await codes((await run([...base, { name: "pkg/steps/02.md", data: "../../../etc/passwd", symlink: true }])).result);
    assert.deepEqual(found, ["ZIP_SYMLINK"]);
  });

  it("bomba de descompressão: tamanho declarado acima do teto", async () => {
    const big = Buffer.alloc(400_000, 0); // deflate reduz a quase nada
    const found = await codes((await run([...base, { name: "pkg/knowledge/a.md", data: big }, { name: "pkg/knowledge/b.md", data: big }], { expandedBytes: 500_000 })).result);
    assert.ok(found.includes("ZIP_EXPANDS_TOO_MUCH"));
  });

  it("bomba que mente no cabeçalho: a contagem em streaming aborta e apaga o que gravou", async () => {
    const real = Buffer.alloc(900_000, 0x61);
    const { dest, result } = await run([...base, { name: "pkg/knowledge/a.md", data: real, declaredSize: 10 }], { expandedBytes: 100_000, fileBytes: 10_000_000 });
    const found = await codes(result);
    assert.deepEqual(found, ["ZIP_EXPANDS_TOO_MUCH"]);
    assert.ok(!existsSync(dest));
  });

  it("cabeçalho que mente para menos, sem estourar nada, também é recusado", async () => {
    const found = await codes((await run([...base, { name: "pkg/knowledge/a.md", data: "x".repeat(2000), declaredSize: 10 }])).result);
    assert.deepEqual(found, ["ZIP_EXPANDS_TOO_MUCH"]);
  });

  it("arquivo individual acima do teto (declarado e real)", async () => {
    const found = await codes((await run([...base, { name: "pkg/knowledge/a.md", data: "x".repeat(5000) }], { fileBytes: 1000 })).result);
    assert.ok(found.includes("FILE_TOO_LARGE"));
    const lying = await codes((await run([...base, { name: "pkg/knowledge/a.md", data: "x".repeat(5000), declaredSize: 500 }], { fileBytes: 1000 })).result);
    assert.deepEqual(lying, ["FILE_TOO_LARGE"]);
  });

  it("teto de arquivos e de tamanho do ZIP", async () => {
    const many: ZipSpec[] = [...base, { name: "pkg/a.md", data: "1" }, { name: "pkg/b.md", data: "2" }];
    assert.ok((await codes((await run(many, { files: 3 })).result)).includes("ZIP_TOO_MANY_FILES"));
    assert.deepEqual(await codes((await run(base, { zipBytes: 50 })).result), ["ZIP_TOO_LARGE"]);
  });

  it("raiz: precisa ser uma pasta só com o manifest.json", async () => {
    assert.ok((await codes((await run([{ name: "manifest.json", data: "{}" }])).result)).includes("ZIP_BAD_ROOT"), "arquivo solto");
    assert.ok((await codes((await run([...base, { name: "outra/manifest.json", data: "{}" }])).result)).includes("ZIP_BAD_ROOT"), "duas raízes");
    assert.ok((await codes((await run([{ name: "pkg/steps/01.md", data: "x" }])).result)).includes("ZIP_BAD_ROOT"), "sem manifest");
    assert.ok((await codes((await run([{ name: "pkg/sub/manifest.json", data: "{}" }])).result)).includes("ZIP_BAD_ROOT"), "manifest fora da raiz");
    assert.ok((await codes((await run([])).result)).includes("ZIP_BAD_ROOT"), "ZIP vazio");
  });

  it("só .json .md .txt e só UTF-8", async () => {
    for (const bad of ["pkg/run.sh", "pkg/steps/a.exe", "pkg/leia-me", "pkg/img.png", "pkg/x.html"]) {
      assert.ok((await codes((await run([...base, { name: bad, data: "x" }])).result)).includes("FILE_TYPE_NOT_ALLOWED"), bad);
    }
    const found = await codes((await run([...base, { name: "pkg/knowledge/l1.md", data: Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]) }])).result);
    assert.deepEqual(found, ["FILE_NOT_UTF8"]);
  });

  it("lista todos os problemas achados no diretório central de uma vez", async () => {
    const { result } = await run([...base, { name: "pkg/x.sh", data: "x" }, { name: "pkg/l", data: "x", symlink: true }, { name: "pkg/../y.md", data: "x" }]);
    const found = new Set(await codes(result));
    assert.ok(found.has("FILE_TYPE_NOT_ALLOWED") && found.has("ZIP_SYMLINK") && found.has("ZIP_BAD_PATH"));
  });

  it("arquivo que não é ZIP", async () => {
    const zip = join(tmp, "lixo.zip");
    await writeFile(zip, "isto não é um zip");
    assert.deepEqual(await codes(extractZip(zip, join(tmp, "lixo-out"), NUCLEO_ZIP_LIMITS)), ["ZIP_UNREADABLE"]);
  });
});

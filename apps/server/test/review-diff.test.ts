import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DIFF_MAX_LINES_PER_FILE, DIFF_MAX_LINES_TOTAL, diffLines, diffPackages, unifiedHunks } from "../src/review/diff.js";
import { packageFromMemory } from "../src/runtime/validate/input.js";
import { baseFiles, editManifest, type Files } from "./validate-fixtures.js";

// Diff do pacote contra a versão publicada (PACKAGE_SPEC.md 14.5, item 3). Puro, em memória.

const pkg = (f: Files) => packageFromMemory(f);
const status = (d: ReturnType<typeof diffPackages>) => Object.fromEntries(d.files.map((x) => [x.path, x.diff]));
const body = (d: ReturnType<typeof diffPackages>, path: string) => d.changed.find((c) => c.path === path)?.unified ?? "";

/** Reaplica o diff sobre `a` e confere que reproduz `b` (propriedade que vale para qualquer diff correto). */
function apply(a: string[], ops: ReturnType<typeof diffLines>): string[] {
  const out: string[] = [];
  let i = 0;
  for (const o of ops) {
    if (o.t === " ") {
      assert.equal(a[i], o.s);
      out.push(o.s);
      i++;
    } else if (o.t === "-") {
      assert.equal(a[i], o.s);
      i++;
    } else out.push(o.s);
  }
  assert.equal(i, a.length);
  return out;
}

describe("diffPackages: status por arquivo", () => {
  it("1ª versão (prev null): tudo added, inclusive conhecimento", () => {
    const d = diffPackages(null, pkg(baseFiles()));
    assert.ok(d.files.length >= 15);
    assert.ok(d.files.every((f) => f.diff === "added"));
    assert.equal(d.changed.length, d.files.length);
    assert.match(body(d, "steps/01-levantar.md"), /^--- \/dev\/null\n\+\+\+ b\/steps\/01-levantar\.md\n@@ -0,0 \+1,\d+ @@\n\+# Etapa 1/);
  });

  it("added, removed, changed e same, com tamanho do arquivo novo (ou do antigo se removido)", () => {
    const a = baseFiles();
    const b = baseFiles();
    b["steps/02-classificar.md"] += "\nLinha nova.\n";
    delete b["knowledge/limites-faturamento.md"];
    b["knowledge/novo.md"] = "# Novo\n\nTexto.\n";
    const d = diffPackages(pkg(a), pkg(b));
    const s = status(d);
    assert.equal(s["steps/02-classificar.md"], "changed");
    assert.equal(s["knowledge/limites-faturamento.md"], "removed");
    assert.equal(s["knowledge/novo.md"], "added");
    assert.equal(s["steps/01-levantar.md"], "same");
    assert.equal(s["manifest.json"], "same");
    assert.equal(d.files.find((x) => x.path === "knowledge/novo.md")!.size, new TextEncoder().encode("# Novo\n\nTexto.\n").byteLength);
    assert.equal(d.files.find((x) => x.path === "knowledge/limites-faturamento.md")!.size, new TextEncoder().encode(a["knowledge/limites-faturamento.md"] as string).byteLength);
    assert.deepEqual(d.changed.map((c) => c.path).sort(), ["knowledge/limites-faturamento.md", "knowledge/novo.md", "steps/02-classificar.md"]);
  });

  it("pacote igual: tudo same e nenhum diff", () => {
    const d = diffPackages(pkg(baseFiles()), pkg(baseFiles()));
    assert.ok(d.files.every((f) => f.diff === "same"));
    assert.deepEqual(d.changed, []);
    assert.equal(d.truncated, false);
  });

  it("CRLF x LF em texto é o mesmo conteúdo (como no hash do pacote)", () => {
    const a = baseFiles();
    const b = baseFiles();
    b["steps/01-levantar.md"] = (b["steps/01-levantar.md"] as string).replace(/\n/g, "\r\n");
    assert.equal(status(diffPackages(pkg(a), pkg(b)))["steps/01-levantar.md"], "same");
  });

  it("arquivos sem texto: compara os bytes e não tenta diff de linhas", () => {
    const a = baseFiles();
    const b = baseFiles();
    a["templates/logo.png"] = new Uint8Array([1, 2, 3]);
    b["templates/logo.png"] = new Uint8Array([1, 2, 4]);
    const d = diffPackages(pkg(a), pkg(b));
    assert.equal(status(d)["templates/logo.png"], "changed");
    assert.match(body(d, "templates/logo.png"), /arquivo binário: alterado; tamanho 3 -> 3 bytes/);
  });

  it("ignora lixo de sistema e links simbólicos", () => {
    const input = pkg(baseFiles());
    input.entries.push({ path: "__MACOSX/._a", size: 1 }, { path: ".DS_Store", size: 1 }, { path: "x.md", size: 0, isSymlink: true });
    const d = diffPackages(null, input);
    assert.ok(d.files.every((f) => !f.path.includes("MACOSX") && f.path !== ".DS_Store" && f.path !== "x.md"));
  });

  it("os arquivos saem em ordem alfabética e o diff põe manifesto e etapas antes do conhecimento", () => {
    const d = diffPackages(null, pkg(baseFiles()));
    const paths = d.files.map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort());
    const order = d.changed.map((c) => c.path);
    assert.equal(order[0], "manifest.json");
    assert.ok(order.indexOf("steps/01-levantar.md") < order.indexOf("knowledge/das-mei-2026.md"));
  });
});

describe("diffPackages: diff unificado", () => {
  it("mostra só o que mudou, com contexto e cabeçalho de hunk", () => {
    const a = baseFiles();
    const b = baseFiles();
    b["steps/02-classificar.md"] = (b["steps/02-classificar.md"] as string).replace("- Esquecer o acumulado do ano.", "- Esquecer o acumulado do ano.\n- Misturar CPF e CNPJ.");
    const d = diffPackages(pkg(a), pkg(b));
    const u = body(d, "steps/02-classificar.md");
    assert.match(u, /^--- a\/steps\/02-classificar\.md\n\+\+\+ b\/steps\/02-classificar\.md\n@@ -\d+,\d+ \+\d+,\d+ @@/);
    assert.match(u, /\n\+- Misturar CPF e CNPJ\./);
    assert.ok(!/\n-[^-]/.test(u), "nada foi removido");
    assert.match(u, /\n ## Erros comuns/, "linhas de contexto começam com espaço");
    assert.equal(d.changed.find((c) => c.path === "steps/02-classificar.md")!.truncated, false);
  });

  it("manifesto minificado vira diff por campo (JSON indentado)", () => {
    const a = baseFiles();
    const b = baseFiles();
    editManifest(b, (m) => {
      (m.pricing as any).priceUsdc = 12;
      m.version = "1.1.0";
    });
    const u = body(diffPackages(pkg(a), pkg(b)), "manifest.json");
    assert.match(u, /\n-    "priceUsdc": 9,/);
    assert.match(u, /\n\+    "priceUsdc": 12,/);
    assert.match(u, /\n\+  "version": "1\.1\.0",/);
    assert.ok(u.split("\n").length < 40, "só os hunks, não o manifesto inteiro");
  });

  it("mudança só de espaços em JSON é 'changed' com explicação", () => {
    const a = baseFiles();
    const b = baseFiles();
    b["manifest.json"] = JSON.stringify(JSON.parse(a["manifest.json"] as string), null, 4);
    const d = diffPackages(pkg(a), pkg(b));
    assert.equal(status(d)["manifest.json"], "changed");
    assert.match(body(d, "manifest.json"), /sem diferença de linhas/);
  });

  it("arquivo removido: tudo '-' contra /dev/null", () => {
    const a = baseFiles();
    const b = baseFiles();
    delete b["templates/relatorio-mensal.md"];
    const u = body(diffPackages(pkg(a), pkg(b)), "templates/relatorio-mensal.md");
    assert.match(u, /^--- a\/templates\/relatorio-mensal\.md\n\+\+\+ \/dev\/null\n@@ -1,3 \+0,0 @@\n-# Relatório mensal/);
  });
});

describe("diffPackages: tetos de tamanho", () => {
  const big = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `linha ${tag} ${i}`).join("\n") + "\n";

  it("corta cada arquivo em 400 linhas e marca como truncado", () => {
    const a = baseFiles();
    const b = baseFiles();
    b["knowledge/grande.md"] = big(1000, "x");
    const d = diffPackages(pkg(a), pkg(b));
    const c = d.changed.find((x) => x.path === "knowledge/grande.md")!;
    assert.equal(c.truncated, true);
    assert.equal(d.truncated, true);
    const lines = c.unified.split("\n");
    assert.equal(lines.length, DIFF_MAX_LINES_PER_FILE + 1);
    assert.match(lines[lines.length - 1]!, /diff truncado: mais \d+ linha/);
  });

  it("corta o total em 2.000 linhas; o resto dos arquivos recebe o aviso de omitido", () => {
    const a = baseFiles();
    const b = baseFiles();
    for (let i = 0; i < 8; i++) b[`knowledge/g${i}.md`] = big(500, `g${i}`);
    const d = diffPackages(pkg(a), pkg(b));
    const emitted = d.changed.filter((c) => !c.unified.startsWith("(omitido")).reduce((s, c) => s + c.unified.split("\n").filter((l) => !l.startsWith("… diff truncado")).length, 0);
    assert.ok(emitted <= DIFF_MAX_LINES_TOTAL, `${emitted} linhas`);
    assert.ok(d.changed.some((c) => c.unified.startsWith("(omitido")), "algum arquivo ficou de fora");
    assert.equal(d.truncated, true);
    assert.equal(d.files.filter((f) => f.diff === "added").length >= 8, true, "o status de TODOS os arquivos continua completo");
  });

  it("arquivo de texto enorme não trava (limite de bytes e de distância de edição)", () => {
    const a = baseFiles();
    const b = baseFiles();
    a["knowledge/enorme.md"] = big(40_000, "a");
    b["knowledge/enorme.md"] = big(40_000, "b"); // nada em comum: pior caso do algoritmo
    const t = Date.now();
    const d = diffPackages(pkg(a), pkg(b));
    assert.ok(Date.now() - t < 5000, `levou ${Date.now() - t} ms`);
    assert.equal(status(d)["knowledge/enorme.md"], "changed");
    assert.equal(d.changed.find((c) => c.path === "knowledge/enorme.md")!.truncated, true);
  });
});

describe("diffLines e unifiedHunks (algoritmo)", () => {
  const cases: [string, string[], string[]][] = [
    ["iguais", ["a", "b", "c"], ["a", "b", "c"]],
    ["inserção no meio", ["a", "c"], ["a", "b", "c"]],
    ["remoção no começo", ["a", "b", "c"], ["b", "c"]],
    ["troca de linha", ["a", "b", "c"], ["a", "x", "c"]],
    ["tudo diferente", ["a", "b"], ["x", "y", "z"]],
    ["vazio para algo", [], ["a"]],
    ["algo para vazio", ["a", "b"], []],
    ["blocos repetidos", ["a", "a", "b", "a", "a"], ["a", "b", "a", "a", "a"]],
    ["misto", "abcabba".split(""), "cbabac".split("")],
  ];
  for (const [name, a, b] of cases) {
    it(`reproduz o texto novo: ${name}`, () => assert.deepEqual(apply(a, diffLines(a, b)), b));
  }

  it("diff mínimo no exemplo clássico (ABCABBA -> CBABAC tem distância 5)", () => {
    const ops = diffLines("abcabba".split(""), "cbabac".split(""));
    assert.equal(ops.filter((o) => o.t !== " ").length, 5);
  });

  it("propriedade: 200 pares aleatórios sempre reaplicam", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rnd(30) }, () => String(rnd(5)));
      const b = Array.from({ length: rnd(30) }, () => String(rnd(5)));
      assert.deepEqual(apply(a, diffLines(a, b)), b);
    }
  });

  it("hunks distantes ficam separados e os próximos se juntam", () => {
    const a = Array.from({ length: 40 }, (_, i) => `l${i}`);
    const b = [...a];
    b[2] = "X";
    b[30] = "Y";
    assert.equal(unifiedHunks(diffLines(a, b)).filter((l) => l.startsWith("@@")).length, 2);
    const c = [...a];
    c[10] = "X";
    c[13] = "Y";
    assert.equal(unifiedHunks(diffLines(a, c)).filter((l) => l.startsWith("@@")).length, 1);
  });
});

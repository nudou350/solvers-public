import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { installDeliverable } from "../src/verifier/install.js";
import { withKeyLock } from "../src/verifier/lock.js";
import { evaluateReport, planMarkPassed, type EvalInput } from "../src/verifier/report.js";
import { dirUsage, readRegularFile, readRegularJson } from "../src/verifier/safe-read.js";

// Verificador: leitura segura do que volta do container, validação do relatório, mutex por etapa
// e decisão do mark_passed. Sem Docker, banco ou env.

const isWin = process.platform === "win32";

describe("readRegularFile / readRegularJson", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "verifier-safe-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("lê arquivo comum e JSON válido", () => {
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ a: 1 }));
    const r = readRegularFile(join(dir, "ok.json"), 1000);
    assert.ok(r.ok && r.data.toString() === '{"a":1}');
    assert.deepEqual(readRegularJson(join(dir, "ok.json"), 1000), { ok: true, value: { a: 1 } });
  });

  it("arquivo ausente é 'missing', não exceção", () => {
    const r = readRegularFile(join(dir, "nao-existe"), 1000);
    assert.deepEqual(r, { ok: false, reason: "missing" });
  });

  it("recusa symlink (mesmo para um arquivo legível do host)", (t) => {
    const target = join(dir, "segredo.txt");
    writeFileSync(target, "CHAVE-PRIVADA");
    const link = join(dir, "preview.html");
    try {
      symlinkSync(target, link);
    } catch {
      t.skip("sem permissão para criar symlink neste ambiente");
      return;
    }
    const r = readRegularFile(link, 1000);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "not_regular");
    assert.equal(readRegularJson(link, 1000).ok, false);
  });

  it("recusa symlink quebrado e symlink para diretório", (t) => {
    try {
      symlinkSync(join(dir, "nada"), join(dir, "quebrado"));
      mkdirSync(join(dir, "sub"));
      symlinkSync(join(dir, "sub"), join(dir, "para-dir"));
    } catch {
      t.skip("sem permissão para criar symlink neste ambiente");
      return;
    }
    assert.equal(!readRegularFile(join(dir, "quebrado"), 10).ok, true);
    assert.equal(!readRegularFile(join(dir, "para-dir"), 10).ok, true);
  });

  it("recusa diretório", () => {
    mkdirSync(join(dir, "uma-pasta"), { recursive: true });
    const r = readRegularFile(join(dir, "uma-pasta"), 1000);
    assert.equal(!r.ok && r.reason, "not_regular");
  });

  it("recusa FIFO sem travar (readFileSync travaria o servidor)", (t) => {
    if (isWin) {
      t.skip("mkfifo não existe no Windows");
      return;
    }
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);
    const r = readRegularFile(fifo, 1000);
    assert.equal(!r.ok && r.reason, "not_regular");
  });

  it("recusa arquivo maior que o limite sem lê-lo", () => {
    writeFileSync(join(dir, "grande.json"), Buffer.alloc(5000, 0x20));
    const r = readRegularFile(join(dir, "grande.json"), 1000);
    assert.equal(!r.ok && r.reason, "too_large");
    assert.equal(readRegularFile(join(dir, "grande.json"), 5000).ok, true);
  });

  it("JSON inválido vira falha, nunca exceção", () => {
    writeFileSync(join(dir, "ruim.json"), "{ nao eh json");
    const r = readRegularJson(join(dir, "ruim.json"), 1000);
    assert.equal(!r.ok && r.reason, "invalid_json");
    writeFileSync(join(dir, "vazio.json"), "");
    assert.equal(!readRegularJson(join(dir, "vazio.json"), 1000).ok, true);
  });
});

describe("dirUsage", () => {
  it("soma arquivos sem seguir symlink e para no limite de entradas", () => {
    const d = mkdtempSync(join(tmpdir(), "verifier-usage-"));
    try {
      writeFileSync(join(d, "a"), Buffer.alloc(3000));
      mkdirSync(join(d, "x"));
      writeFileSync(join(d, "x", "b"), Buffer.alloc(2000));
      const u = dirUsage(d, 100);
      assert.ok(u.bytes >= 5000 && !u.truncated);
      for (let i = 0; i < 20; i++) writeFileSync(join(d, `f${i}`), "");
      assert.equal(dirUsage(d, 10).truncated, true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("dirUsage: leitura incremental e symlink", () => {
  it("não segue symlink para pasta (não soma o que está fora)", (t) => {
    const out = mkdtempSync(join(tmpdir(), "verifier-out-"));
    const d = mkdtempSync(join(tmpdir(), "verifier-in-"));
    try {
      writeFileSync(join(out, "enorme"), Buffer.alloc(100_000));
      try {
        symlinkSync(out, join(d, "atalho"));
      } catch {
        t.skip("sem permissão para criar symlink neste ambiente");
        return;
      }
      const u = dirUsage(d);
      assert.ok(u.bytes < 50_000, `somou ${u.bytes} bytes através do symlink`);
      assert.equal(u.truncated, false);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("para no teto de entradas de uma pasta grande", () => {
    const d = mkdtempSync(join(tmpdir(), "verifier-many-"));
    try {
      for (let i = 0; i < 300; i++) writeFileSync(join(d, `f${i}`), "");
      const u = dirUsage(d, 50);
      assert.equal(u.truncated, true);
      assert.equal(u.entries, 51); // parou logo depois do teto, sem contar as 300
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("pasta inexistente: zero, sem exceção", () => {
    assert.deepEqual(dirUsage(join(tmpdir(), "nao-existe-verifier-xyz")), { bytes: 0, entries: 0, truncated: false });
  });
});

describe("installDeliverable (instalação com desfazer)", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const mk = () => mkdtempSync(join(tmpdir(), "verifier-install-"));

  it("instala do zero e commit não deixa sobras", () => {
    const m = mk();
    try {
      const i = installDeliverable(m, { "A.tsx": "a", "sub/B.tsx": "b" }, "<p>1</p>");
      assert.equal(i.dir, join(m, "files"));
      assert.equal(read(join(m, "files", "sub", "B.tsx")), "b");
      assert.equal(read(join(m, "preview.html")), "<p>1</p>");
      i.commit();
      assert.deepEqual(readdirSync(m).sort(), ["files", "preview.html"]);
    } finally {
      rmSync(m, { recursive: true, force: true });
    }
  });

  it("substitui a entrega anterior por completo e commit remove o backup", () => {
    const m = mk();
    try {
      installDeliverable(m, { "Velho.tsx": "velho", "Outro.tsx": "x" }, "<p>velha</p>").commit();
      const i = installDeliverable(m, { "Novo.tsx": "novo" }, null);
      assert.deepEqual(readdirSync(join(m, "files")), ["Novo.tsx"]);
      assert.equal(existsSync(join(m, "preview.html")), false); // sem prévia nova, a antiga não fica
      i.commit();
      assert.deepEqual(readdirSync(m).sort(), ["files"]);
    } finally {
      rmSync(m, { recursive: true, force: true });
    }
  });

  it("undo devolve exatamente a entrega e a prévia anteriores", () => {
    const m = mk();
    try {
      installDeliverable(m, { "A.tsx": "de-A" }, "<p>A</p>").commit();
      const b = installDeliverable(m, { "B.tsx": "de-B" }, "<p>B</p>");
      assert.equal(read(join(m, "files", "B.tsx")), "de-B");
      b.undo();
      assert.deepEqual(readdirSync(join(m, "files")), ["A.tsx"]);
      assert.equal(read(join(m, "files", "A.tsx")), "de-A");
      assert.equal(read(join(m, "preview.html")), "<p>A</p>");
      assert.deepEqual(readdirSync(m).filter((n) => n.startsWith(".")), []);
    } finally {
      rmSync(m, { recursive: true, force: true });
    }
  });

  it("undo da primeira instalação deixa a etapa sem entrega", () => {
    const m = mk();
    try {
      installDeliverable(m, { "A.tsx": "a" }, "<p>A</p>").undo();
      assert.equal(existsSync(join(m, "files")), false);
      assert.equal(existsSync(join(m, "preview.html")), false);
    } finally {
      rmSync(m, { recursive: true, force: true });
    }
  });
});

// ---------- Validação do relatório ----------

const pass = (title: string) => ({ fullName: title, title, status: "passed", failureMessages: [] });
const fail = (title: string, msg = "boom") => ({ fullName: title, title, status: "failed", failureMessages: [msg] });
const file = (name: string, assertionResults: unknown[], status = "passed") => ({ name: `/work/${name}`, status, assertionResults });

function input(over: Partial<EvalInput> & { json: unknown }): EvalInput {
  return { exitCode: 0, out: "", acceptanceFiles: null, durationMs: 1, ...over };
}

describe("evaluateReport", () => {
  it("aprova: código 0, testes passando, sem bateria", () => {
    const r = evaluateReport(input({ json: { success: true, testResults: [file("src/A.test.tsx", [pass("a")])] } }));
    assert.equal(r.passed, true);
    assert.equal(r.numTests, 1);
    assert.equal(r.acceptance, null);
  });

  it("exige código de saída 0 mesmo com relatório 'perfeito' (relatório forjado)", () => {
    const forged = { success: true, testResults: [file("src/acceptance.A.test.tsx", [pass("fake")])] };
    const r = evaluateReport(input({ json: forged, exitCode: 1, acceptanceFiles: ["acceptance.A.test.tsx"] }));
    assert.equal(r.passed, false);
    assert.match(r.failures[0]!.message, /código 1/);
  });

  it("timeout e estouro do relatório reprovam", () => {
    const ok = { testResults: [file("src/A.test.tsx", [pass("a")])] };
    assert.equal(evaluateReport(input({ json: ok, exitCode: 137, timedOut: true })).passed, false);
    assert.equal(evaluateReport(input({ json: ok, overflow: true })).passed, false);
  });

  it("relatório ausente ou inválido vira falha de execução", () => {
    const r = evaluateReport(input({ json: null, jsonProblem: "O relatório de testes não é um JSON válido" }));
    assert.equal(r.passed, false);
    assert.equal(r.failures[0]!.test, "execução");
    assert.match(r.failures[0]!.message, /JSON válido/);
    assert.equal(evaluateReport(input({ json: [1, 2] })).passed, false);
    assert.equal(evaluateReport(input({ json: "texto" })).passed, false);
  });

  it("zero testes reprova", () => {
    assert.equal(evaluateReport(input({ json: { testResults: [] } })).passed, false);
    assert.equal(evaluateReport(input({ json: { testResults: [file("src/A.test.tsx", [])] } })).passed, false);
  });

  it("teste falhando reprova e lista a falha", () => {
    const r = evaluateReport(input({ json: { testResults: [file("src/A.test.tsx", [pass("a"), fail("b", "x")])] }, exitCode: 1 }));
    assert.equal(r.passed, false);
    assert.equal(r.numFailed, 1);
    assert.deepEqual(r.failures.map((f) => f.test), ["b"]);
  });

  it("teste pulado ou todo não conta como aprovado", () => {
    const skipped = { fullName: "s", title: "s", status: "skipped", failureMessages: [] };
    assert.equal(evaluateReport(input({ json: { testResults: [file("src/A.test.tsx", [pass("a"), skipped])] } })).passed, false);
  });

  it("arquivo de teste que não carregou (erro de import) reprova", () => {
    const r = evaluateReport(
      input({ json: { testResults: [file("src/A.test.tsx", [pass("a")]), { name: "/work/src/B.test.tsx", status: "failed", message: "Cannot find module", assertionResults: [] }] } }),
    );
    assert.equal(r.passed, false);
    assert.equal(r.failures[0]!.test, "src/B.test.tsx");
  });

  it("o teste auxiliar de prévia não conta (caminho exato)", () => {
    const r = evaluateReport(input({ json: { testResults: [file("src/A.test.tsx", [pass("a")]), file("src/__preview__.test.tsx", [fail("__preview__")])] } }));
    assert.equal(r.numTests, 1);
    assert.equal(r.passed, true);
  });

  it("um arquivo com '__preview__' no nome (da entrega) CONTA e pode reprovar", () => {
    const r = evaluateReport(input({ json: { testResults: [file("src/A.test.tsx", [pass("a")]), file("src/x__preview__.test.tsx", [fail("ruim")])] }, exitCode: 1 }));
    assert.equal(r.passed, false);
  });

  describe("bateria de aceite", () => {
    const acc = ["acceptance.A.test.tsx", "acceptance.B.test.tsx"];

    it("aprova quando todos os arquivos esperados rodaram e passaram", () => {
      const json = { testResults: [file("src/acceptance.A.test.tsx", [pass("a1"), pass("a2")]), file("src/acceptance.B.test.tsx", [pass("b1")]), file("src/A.test.tsx", [pass("own")])] };
      const r = evaluateReport(input({ json, acceptanceFiles: acc }));
      assert.equal(r.passed, true);
      assert.deepEqual(r.acceptance, { numTests: 3, numPassed: 3 });
      assert.equal(r.numTests, 4);
    });

    it("reprova se um arquivo esperado da bateria não aparece no relatório", () => {
      const json = { testResults: [file("src/acceptance.A.test.tsx", [pass("a1")]), file("src/A.test.tsx", [pass("own")])] };
      const r = evaluateReport(input({ json, acceptanceFiles: acc }));
      assert.equal(r.passed, false);
      assert.ok(r.failures.some((f) => f.test === "acceptance.B.test.tsx"));
    });

    it("reprova se o arquivo esperado rodou sem nenhum teste", () => {
      const json = { testResults: [file("src/acceptance.A.test.tsx", [pass("a1")]), file("src/acceptance.B.test.tsx", [])] };
      assert.equal(evaluateReport(input({ json, acceptanceFiles: acc })).passed, false);
    });

    it("reprova se um teste da bateria falhou", () => {
      const json = { testResults: [file("src/acceptance.A.test.tsx", [pass("a1"), fail("a2")]), file("src/acceptance.B.test.tsx", [pass("b1")])] };
      const r = evaluateReport(input({ json, acceptanceFiles: acc, exitCode: 1 }));
      assert.equal(r.passed, false);
      assert.deepEqual(r.acceptance, { numTests: 3, numPassed: 2 });
    });

    it("entrega em pasta 'acceptance.x/' não é contada como bateria (caminho exato)", () => {
      const json = { testResults: [file("src/acceptance.A.test.tsx", [pass("a1")]), file("src/acceptance.B.test.tsx", [pass("b1")]), file("src/acceptance.d/fake.test.tsx", [pass("f1"), pass("f2")])] };
      const r = evaluateReport(input({ json, acceptanceFiles: acc }));
      assert.equal(r.passed, true);
      assert.deepEqual(r.acceptance, { numTests: 2, numPassed: 2 });
    });

    it("testes da própria entrega passando não substituem a bateria ausente", () => {
      const json = { testResults: [file("src/Own.test.tsx", [pass("trivial")])] };
      assert.equal(evaluateReport(input({ json, acceptanceFiles: acc })).passed, false);
    });
  });
});

// ---------- mark_passed idempotente ----------

describe("planMarkPassed", () => {
  const h = "ab".repeat(32);
  it("pendente ou estado desconhecido: envia", () => {
    assert.equal(planMarkPassed({ status: 0, deliverableHash: "00".repeat(32) }, h), "send");
    assert.equal(planMarkPassed(null, h), "send");
  });
  it("já Passed com o mesmo hash: não reenvia", () => {
    assert.equal(planMarkPassed({ status: 1, deliverableHash: h }, h), "already");
    assert.equal(planMarkPassed({ status: 1, deliverableHash: h.toUpperCase() }, h), "already");
  });
  it("Passed com outro hash, ou em outro estado: conflito", () => {
    assert.equal(planMarkPassed({ status: 1, deliverableHash: "cd".repeat(32) }, h), "conflict");
    assert.equal(planMarkPassed({ status: 2, deliverableHash: h }, h), "conflict");
    assert.equal(planMarkPassed({ status: 3, deliverableHash: h }, h), "conflict");
  });
});

// ---------- Mutex por etapa ----------

describe("withKeyLock", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("serializa a mesma chave (sem sobreposição e em ordem)", async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await sleep(ms);
      log.push(`${name}:end`);
      return name;
    };
    const res = await Promise.all([withKeyLock("e:0", job("A", 30)), withKeyLock("e:0", job("B", 5)), withKeyLock("e:0", job("C", 1))]);
    assert.deepEqual(res, ["A", "B", "C"]);
    assert.deepEqual(log, ["A:start", "A:end", "B:start", "B:end", "C:start", "C:end"]);
  });

  it("chaves diferentes rodam em paralelo", async () => {
    const log: string[] = [];
    await Promise.all([
      withKeyLock("e:1", async () => {
        log.push("1:start");
        await sleep(20);
        log.push("1:end");
      }),
      withKeyLock("e:2", async () => {
        log.push("2:start");
        await sleep(1);
        log.push("2:end");
      }),
    ]);
    assert.deepEqual(log, ["1:start", "2:start", "2:end", "1:end"]);
  });

  it("erro de uma execução não trava a fila da chave", async () => {
    const a = withKeyLock("e:3", async () => {
      await sleep(5);
      throw new Error("falhou");
    });
    const b = withKeyLock("e:3", async () => "b");
    await assert.rejects(a, /falhou/);
    assert.equal(await b, "b");
  });
});

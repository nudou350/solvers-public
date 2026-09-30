import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FREE_TRIAL_USES } from "@solvers/shared";
import { escrowGivesAccess, paidAccessLine } from "../src/runtime/access-rules.js";
import { Manifest } from "../src/runtime/manifest.js";
import { myTrial, trialAccessLine, trialEndText, trialInfo, trialLeft, trialLimits, trialStepLocked } from "../src/runtime/trial.js";

// Teste grátis por especialista (manifest.trial): schema, limites e textos (sem env ou banco).

const base = {
  id: "0".repeat(32),
  slug: "exemplo",
  name: "Exemplo",
  tagline: "t",
  description: "d",
  category: "Desenvolvimento",
  version: "1.0.0",
  creator: { id: "c", name: "C", bio: "" },
  requirements: [],
  packageContents: [],
  steps: [{ file: "1.md" }, { file: "2.md" }, { file: "3.md" }, { file: "4.md" }],
  tools: [
    { name: "run_tests", description: "", runner: "docker:solvers-react-test" },
    { name: "a11y_check", description: "", runner: "node:a11y" },
  ],
  guarantee: { available: false },
  pricing: { priceUsdc: 19, royaltyBps: 500 },
};
const trial = {
  steps: 2,
  searches: 15,
  tools: { run_tests: 1 },
  summary: "Você recebe o plano e o componente.",
  lockedSummary: "a revisão final com testes ilimitados.",
};
const parse = (extra: Record<string, unknown>) => Manifest.parse({ ...base, ...extra });
const pkgOf = (m: Manifest) => ({ manifest: m, steps: m.steps.map((s) => ({ title: s.file, body: "", gate: [] })) });

describe("manifest.trial", () => {
  it("sem trial ou available=false: sem teste grátis", () => {
    assert.equal(trialLimits(parse({})), null);
    assert.equal(trialLimits(parse({ trial: { ...trial, available: false } })), null);
    assert.equal(trialInfo(pkgOf(parse({}))), null);
  });

  it("padrões: available true, uses = FREE_TRIAL_USES, tools {}", () => {
    const t = trialLimits(parse({ trial: { ...trial, tools: undefined } }))!;
    assert.equal(t.uses, FREE_TRIAL_USES);
    assert.deepEqual(t.tools, {});
  });

  it("pricePerUseUsdc de manifest antigo é ignorado", () => {
    const m = parse({ pricing: { priceUsdc: 19, pricePerUseUsdc: 0.9, royaltyBps: 500 } });
    assert.deepEqual(m.pricing, { priceUsdc: 19, royaltyBps: 500 });
  });

  it("rejeita etapas além do método, ferramenta inexistente e uses fora de 1..10", () => {
    assert.throws(() => parse({ trial: { ...trial, steps: 5 } }), /trial.steps/);
    assert.throws(() => parse({ trial: { ...trial, steps: 0 } }));
    assert.throws(() => parse({ trial: { ...trial, tools: { deploy: 1 } } }), /deploy/);
    assert.throws(() => parse({ trial: { ...trial, uses: 11 } }));
    assert.throws(() => parse({ trial: { ...trial, uses: 0 } }));
    assert.throws(() => parse({ trial: { ...trial, searches: -1 } }));
  });

  it("trialInfo para a vitrine: total de etapas e só ferramentas liberadas", () => {
    const info = trialInfo(pkgOf(parse({ trial: { ...trial, tools: { run_tests: 1, a11y_check: 0 } } })));
    assert.deepEqual(info, {
      uses: 3,
      steps: 2,
      totalSteps: 4,
      searches: 15,
      tools: [{ name: "run_tests", limit: 1 }],
      summary: trial.summary,
      lockedSummary: trial.lockedSummary,
    });
  });

  it("os manifests publicados em agents/ são válidos", () => {
    const root = join(import.meta.dirname, "..", "..", "..", "agents");
    for (const name of readdirSync(root)) {
      const file = join(root, name, "manifest.json");
      if (!existsSync(file)) continue;
      const r = Manifest.safeParse(JSON.parse(readFileSync(file, "utf8")));
      assert.ok(r.success, `${name}: ${r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
  });
});

describe("limites do teste", () => {
  const t = trialLimits(parse({ trial }))!;

  it("etapa bloqueada: índice >= steps, menos o encerramento", () => {
    assert.equal(trialStepLocked(t, 0, 4), false);
    assert.equal(trialStepLocked(t, 1, 4), false);
    assert.equal(trialStepLocked(t, 2, 4), true);
    assert.equal(trialStepLocked(t, 3, 4), true);
    assert.equal(trialStepLocked(t, 4, 4), false);
    const all = trialLimits(parse({ trial: { ...trial, steps: 4 } }))!;
    assert.equal(trialStepLocked(all, 3, 4), false);
  });

  it("saldo do teste inteiro (nunca negativo)", () => {
    assert.deepEqual(trialLeft(t, null), { searchesLeft: 15, toolsLeft: { run_tests: 1 } });
    assert.deepEqual(trialLeft(t, { searchesUsed: 20, toolRuns: { run_tests: 1, a11y_check: 3 } }), { searchesLeft: 0, toolsLeft: { run_tests: 0 } });
  });
});

describe("textos do teste", () => {
  const t = trialLimits(parse({ trial }))!;

  it("fim do teste: nome, o que libera, o que só a licença dá e o link", () => {
    assert.equal(
      trialEndText("Exemplo", t, "https://x/checkout"),
      "O teste grátis de Exemplo vai até aqui: Você recebe o plano e o componente. Com a licença vitalícia você também tem: a revisão final com testes ilimitados. Comprar: https://x/checkout",
    );
  });

  it("linha de acesso: etapas, consultas, ferramentas e aviso", () => {
    const line = trialAccessLine(t, { use: 1, totalSteps: 4, toolNames: ["run_tests", "a11y_check"] });
    assert.equal(
      line,
      "Teste grátis (uso 1 de 3): libera as etapas 1 a 2 de 4, até 15 consultas à base e run_tests 1 vez no total. Depois deste, restam 2 usos grátis. Só com a licença: a11y_check. Você recebe o plano e o componente. Avise o usuário desses limites antes de começar.",
    );
  });

  it("linha de acesso: saldo restante, etapa única e sem consultas", () => {
    const one = trialLimits(parse({ trial: { ...trial, steps: 1, searches: 0, tools: { run_tests: 2 } } }))!;
    const line = trialAccessLine(one, { use: 2, totalSteps: 4, toolNames: ["run_tests"], usage: { searchesUsed: 0, toolRuns: { run_tests: 1 } } });
    assert.match(line, /^Teste grátis \(uso 2 de 3\): libera a etapa 1 de 4, nenhuma consulta à base e run_tests 2 vezes \(restam 1\) no total\./);
    const all = trialLimits(parse({ trial: { ...trial, steps: 4 } }))!;
    assert.match(trialAccessLine(all, { use: 1, totalSteps: 4, toolNames: [] }), /libera as 4 etapas, até 15 consultas/);
  });

  it("linha de acesso: usos que sobram e aviso do último uso", () => {
    const at = (use: number) => trialAccessLine(t, { use, totalSteps: 4, toolNames: [] });
    assert.match(at(2), /Depois deste, resta 1 uso grátis\./);
    assert.match(at(3), /Este é o último uso grátis\./);
  });

  it("resumo para a biblioteca: usos, consultas e ferramentas que sobram", () => {
    const at = new Date("2026-09-30T12:00:00Z");
    assert.deepEqual(myTrial("a1", t, 2, { searchesUsed: 5, toolRuns: { run_tests: 1 } }, at), {
      agentId: "a1",
      uses: 3,
      usesLeft: 1,
      searches: 15,
      searchesLeft: 10,
      tools: [{ name: "run_tests", limit: 1, left: 0 }],
      lastUsedAt: "2026-09-30T12:00:00.000Z",
    });
    assert.equal(myTrial("a1", t, 3, { searchesUsed: 0, toolRuns: {} }, at).usesLeft, 0);
  });
});

describe("acesso pago", () => {
  it("garantia dá acesso só enquanto aberta (confirmada, sem aprovação, reembolso ou fechamento)", () => {
    assert.equal(escrowGivesAccess({ status: "active", closed: false }), true);
    assert.equal(escrowGivesAccess({ status: "disputed", closed: false }), true);
    assert.equal(escrowGivesAccess({ status: "pending", closed: false }), false);
    assert.equal(escrowGivesAccess({ status: "approved", closed: false }), false);
    assert.equal(escrowGivesAccess({ status: "refunded", closed: false }), false);
    assert.equal(escrowGivesAccess({ status: "active", closed: true }), false);
  });

  it("linha de acesso pago", () => {
    assert.equal(paidAccessLine("license"), "Acesso: licença vitalícia.");
    assert.equal(paidAccessLine("guarantee"), "Acesso: tarefa com garantia (sem limites enquanto a garantia estiver aberta).");
  });
});

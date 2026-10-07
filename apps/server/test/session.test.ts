import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/http.js";
import { assertSessionCurrent, licenseRecheckDue, planNextStep, withSummary } from "../src/runtime/session-rules.js";

// Regras puras das sessões do conector (sem env ou banco).

describe("assertSessionCurrent", () => {
  it("mesma versão passa; versão diferente pede nova ativação (409)", () => {
    assert.doesNotThrow(() => assertSessionCurrent("1.0.0", "1.0.0", "X"));
    assert.throws(
      () => assertSessionCurrent("1.0.0", "1.1.0", "Especialista X"),
      (e: unknown) => e instanceof HttpError && e.status === 409 && /Especialista X was updated.*activate_solver/.test(e.message),
    );
  });
});

describe("planNextStep (completed_step)", () => {
  it("sem completed_step: avança como antes (retrocompatível)", () => {
    assert.deepEqual(planNextStep(0), { kind: "advance", index: 0 });
    assert.deepEqual(planNextStep(3), { kind: "advance", index: 3 });
  });

  it("igual às etapas entregues: avança", () => {
    assert.deepEqual(planNextStep(0, 0), { kind: "advance", index: 0 });
    assert.deepEqual(planNextStep(2, 2), { kind: "advance", index: 2 });
  });

  it("menor: reenvia a etapa sem avançar", () => {
    assert.deepEqual(planNextStep(2, 1), { kind: "replay", index: 1 });
    assert.deepEqual(planNextStep(1, 0), { kind: "replay", index: 0 });
  });

  it("maior: badRequest", () => {
    assert.throws(() => planNextStep(1, 2), (e: unknown) => e instanceof HttpError && e.status === 400);
  });

  it("resposta perdida: a repetição não pula etapa", () => {
    // Sessão simulada: stepIndex = etapas entregues.
    let stepIndex = 0;
    const call = (completed?: number) => {
      const plan = planNextStep(stepIndex, completed);
      if (plan.kind === "advance") stepIndex += 1;
      return plan.index;
    };
    assert.equal(call(0), 0); // etapa 1 entregue
    assert.equal(call(1), 1); // etapa 2 entregue, mas a resposta se perde
    assert.equal(call(1), 1); // repetição: etapa 2 de novo, sem avançar
    assert.equal(stepIndex, 2);
    assert.equal(call(2), 2); // a IA segue para a etapa 3
  });
});

describe("withSummary", () => {
  it("grava no slot certo sem mexer nos outros nem no resto do contexto", () => {
    const ctx = { escrowId: "E1", summaries: ["a"] };
    const out = withSummary(ctx, 1, "b");
    assert.deepEqual(out, { escrowId: "E1", summaries: ["a", "b"] });
    assert.deepEqual(ctx.summaries, ["a"]);
  });

  it("slot negativo não grava; corta em 4000 caracteres", () => {
    assert.deepEqual(withSummary({}, -1, "x"), { summaries: [] });
    assert.equal((withSummary({}, 0, "y".repeat(5000)).summaries as string[])[0]!.length, 4000);
  });
});

describe("licenseRecheckDue", () => {
  it("revalida na primeira vez e depois da janela; dentro dela reaproveita", () => {
    assert.equal(licenseRecheckDue(undefined, 1000), true);
    assert.equal(licenseRecheckDue(1000, 1000 + 44_000), false);
    assert.equal(licenseRecheckDue(1000, 1000 + 45_000), true);
    assert.equal(licenseRecheckDue(5000, 1000), true); // relógio voltou
  });
});

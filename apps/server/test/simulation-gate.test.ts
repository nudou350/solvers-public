import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SimulationResult } from "@solvers/chain";
import { HttpError } from "../src/lib/http.js";
import { assertSimulationOk } from "../src/store/simulation-gate.js";

// Simulação antes da assinatura: só recusa por regra do programa; o resto não bloqueia (fail-open) e vai para o log.

const run = (r: SimulationResult) => {
  const logs: string[] = [];
  let thrown: unknown = null;
  try {
    assertSimulationOk(r, "purchase", (m) => logs.push(m));
  } catch (e) {
    thrown = e;
  }
  return { thrown, logs };
};

describe("assertSimulationOk", () => {
  it("simulação ok: segue sem log", () => {
    assert.deepEqual(run({ ok: true, unitsConsumed: 1n }), { thrown: null, logs: [] });
  });

  it("erro do programa: 409 operation_rejected com a mensagem amigável (nunca 422, que o front lê como falha de rede)", () => {
    const { thrown, logs } = run({ ok: false, kind: "rejected", code: 6004, name: "AgentNotActive", message: "Este especialista ainda não está disponível para compra.", logs: [] });
    assert.ok(thrown instanceof HttpError);
    assert.equal(thrown.status, 409);
    assert.equal(thrown.code, "operation_rejected");
    assert.equal(thrown.message, "Este especialista ainda não está disponível para compra.");
    assert.deepEqual(thrown.extra, { programError: "AgentNotActive", programErrorCode: 6004 });
    assert.deepEqual(logs, []);
  });

  it("SoldOut do programa (teto de licenças): 409 sold_out, o mesmo código do pré-check, para a tela mostrar Esgotado", () => {
    const { thrown } = run({ ok: false, kind: "rejected", code: 6060, name: "SoldOut", message: "Esgotado: todas as licenças deste especialista já foram vendidas.", logs: [] });
    assert.ok(thrown instanceof HttpError);
    assert.equal(thrown.status, 409);
    assert.equal(thrown.code, "sold_out");
    assert.match(thrown.message, /Esgotado/);
  });

  it("recusa sem código do programa (saldo): também bloqueia, sem campos de código", () => {
    const { thrown } = run({ ok: false, kind: "rejected", code: null, name: null, message: "Saldo de USDC insuficiente.", logs: [] });
    assert.ok(thrown instanceof HttpError && thrown.status === 409);
  });

  it("RPC fora/timeout: fail-open, registra no log", () => {
    const { thrown, logs } = run({ ok: false, kind: "infra", message: "fetch failed" });
    assert.equal(thrown, null);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /purchase.*indisponível.*fetch failed/);
  });

  it("falha por outro motivo (blockhash, conta ausente): fail-open, registra no log", () => {
    const { thrown, logs } = run({ ok: false, kind: "failed", message: '"BlockhashNotFound"', logs: [] });
    assert.equal(thrown, null);
    assert.match(logs[0]!, /BlockhashNotFound/);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { simulateBlockReason } from "../src/pix/rules.js";

test("simulate: cobrança do provedor simulado pode ser simulada", () => {
  assert.equal(simulateBlockReason("simulated"), null);
});

test("simulate: cobrança do Mercado Pago nunca pode ser aprovada pela rota de simulação (DEF-10)", () => {
  assert.equal(simulateBlockReason("mercadopago"), "pix_not_simulated");
});

test("simulate: provedor desconhecido ou vazio também é recusado", () => {
  assert.equal(simulateBlockReason(""), "pix_not_simulated");
  assert.equal(simulateBlockReason("outro"), "pix_not_simulated");
});

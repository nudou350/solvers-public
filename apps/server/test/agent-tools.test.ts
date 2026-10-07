import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { blockBeforeTrial } from "../src/runtime/access-rules.js";
import { AGENT_CLIENT_ID, isAgentClient } from "../src/oauth/rules.js";
import { AGENT_SERVER_INSTRUCTIONS, AGENT_STEP_NOTE, agentPurchaseLine, agentPurchaseText, evalLabel, networkLabel } from "../src/mcp/agent-text.js";

// Token de agente: o que o distingue (isAgentClient), por que não há teste grátis (blockBeforeTrial) e os textos
// próprios (sem "mostre ao usuário" nem link de checkout). Regras puras, sem banco; o fluxo completo está em agent-auth.db.test.ts.

const AGENT = "0ee9927a8023c955da8d010762eb2efe";

describe("isAgentClient", () => {
  it("só o client_id fixo do login SIWS direto é agente", () => {
    assert.equal(isAgentClient(AGENT_CLIENT_ID), true);
    assert.equal(isAgentClient("agent"), true);
    for (const c of ["cli_abc123", "Agent", "agent ", "", null, undefined]) assert.equal(isAgentClient(c), false, String(c));
  });
});

describe("blockBeforeTrial", () => {
  const base = { licenseUnknown: false, allowTrial: true, agent: false };

  it("pessoa com teste permitido segue para o teste", () => {
    assert.equal(blockBeforeTrial(base), null);
  });

  it("agente nunca chega ao teste (agent_no_trial)", () => {
    assert.equal(blockBeforeTrial({ ...base, agent: true }), "agent_no_trial");
  });

  it("solver aposentado: retired (para pessoa e para agente)", () => {
    assert.equal(blockBeforeTrial({ ...base, allowTrial: false }), "retired");
    assert.equal(blockBeforeTrial({ ...base, allowTrial: false, agent: true }), "retired");
  });

  it("licença não confirmada tem prioridade: nunca manda comprar nem gasta teste por falha de RPC", () => {
    assert.equal(blockBeforeTrial({ licenseUnknown: true, allowTrial: true, agent: false }), "unverified");
    assert.equal(blockBeforeTrial({ licenseUnknown: true, allowTrial: false, agent: true }), "unverified");
  });
});

describe("performance score label (P5)", () => {
  it("no score: no ratings yet, never 0% nor verified", () => {
    assert.equal(evalLabel(0), "performance: no ratings yet");
    assert.doesNotMatch(evalLabel(0), /0%|verified/i);
  });
  it("with a score: internal team test, never verified", () => {
    assert.equal(evalLabel(8250), "internal team test (automated checks): 83%");
    assert.doesNotMatch(evalLabel(8250), /verified/i);
  });
});

describe("textos do agente", () => {
  const p = { apiBase: "https://solvers.example.com", agentId: AGENT, name: "Solver X", priceUsdc: "12.5", network: networkLabel("devnet") };

  it("networkLabel", () => {
    assert.equal(networkLabel("devnet"), "solana-devnet");
    assert.equal(networkLabel("mainnet-beta"), "solana-mainnet");
  });

  it("instruções de compra: endpoint, preço, rede e próximo passo", () => {
    const t = agentPurchaseText(p);
    assert.match(t, new RegExp(`POST https://solvers.example.com/api/x402/solvers/${AGENT}/license`));
    assert.match(t, /402/);
    assert.match(t, /PAYMENT-SIGNATURE/);
    assert.match(t, /solana-devnet/);
    assert.match(t, /12\.5 USDC/);
    assert.match(t, /activate_solver again/);
  });

  it("nenhum texto de agente manda mostrar ao usuário ou usa o checkout", () => {
    for (const t of [agentPurchaseText(p), agentPurchaseLine(p), AGENT_SERVER_INSTRUCTIONS, AGENT_STEP_NOTE]) {
      assert.doesNotMatch(t, /\/checkout/);
      assert.doesNotMatch(t, /show (the )?(link )?to the user|show the link/i);
    }
  });

  it("o cabeçalho das etapas manda decidir pelo contexto e registrar a suposição", () => {
    assert.match(AGENT_STEP_NOTE, /autonomous agent/);
    assert.match(AGENT_STEP_NOTE, /result_summary/);
  });

  it("as instruções do conector avisam que não há teste grátis", () => {
    assert.match(AGENT_SERVER_INSTRUCTIONS, /no free trial/);
  });
});

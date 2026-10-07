import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type * as gen from "@solvers/client";
import { agentMirrorValues } from "../src/indexer/mirror.js";
import { AGENT_ID_RE, isAgentId, slugProblem, versionProblem } from "../src/runtime/agent-ids.js";
import { agentIsAvailable, assertAgentAvailable, PLATFORM_ACTIVE, PLATFORM_SUSPENDED } from "../src/runtime/availability.js";
import { canUseMemory } from "../src/runtime/memory-access.js";
import { HttpError } from "../src/lib/http.js";

// Kill switch da plataforma, acesso à memória e formato de ids (PACKAGE_SPEC.md 11.2, 15.4 e P0). Puro: sem banco.

describe("disponibilidade: status da cadeia E suspensão da plataforma", () => {
  it("só responde e vende com os dois ativos", () => {
    assert.equal(agentIsAvailable({ status: "active", platformStatus: PLATFORM_ACTIVE }), true);
    assert.equal(agentIsAvailable({ status: "active", platformStatus: PLATFORM_SUSPENDED }), false);
    assert.equal(agentIsAvailable({ status: "suspended", platformStatus: PLATFORM_ACTIVE }), false);
    assert.equal(agentIsAvailable({ status: "pending", platformStatus: PLATFORM_ACTIVE }), false);
    assert.equal(agentIsAvailable({ status: "active", platformStatus: "qualquer-outra-coisa" }), false);
  });

  it("assertAgentAvailable: 403 agent_unavailable quando suspenso", () => {
    assert.doesNotThrow(() => assertAgentAvailable({ status: "active", platformStatus: "active" }));
    assert.throws(
      () => assertAgentAvailable({ status: "active", platformStatus: "suspended" }),
      (e: unknown) => e instanceof HttpError && e.status === 403 && e.code === "agent_unavailable",
    );
  });
});

describe("indexador: a suspensão da plataforma sobrevive ao espelho da cadeia", () => {
  // Conta on-chain mínima (só o que o espelho lê).
  const account = (status: number) =>
    ({
      version: "1.0.0",
      versionHash: new Uint8Array(32).fill(1),
      price: 5_000_000n,
      pricePerUse: 0n,
      royaltyBps: 500,
      evalScoreBps: 8000,
      evalHash: new Uint8Array(32).fill(2),
      status,
      totalSales: 3n,
      verifiedUses: 0n,
      ratingSum: 20n,
      ratingCount: 5,
      disputesLost: 0,
      stake: 0n,
      collection: "ColecaoXYZ",
    }) as unknown as gen.Agent;

  it("o objeto gravado pelo indexador NÃO tem platformStatus (nem em nenhum evento)", () => {
    for (const status of [0, 1, 2]) {
      const values = agentMirrorValues(account(status), "EnderecoAgente" as never);
      assert.equal("platformStatus" in values, false, `status on-chain ${status}`);
      assert.equal("platform_status" in values, false);
    }
  });

  it("o espelho continua refletindo o status da cadeia", () => {
    assert.equal(agentMirrorValues(account(0), "x" as never).status, "pending");
    assert.equal(agentMirrorValues(account(1), "x" as never).status, "active");
    assert.equal(agentMirrorValues(account(2), "x" as never).status, "suspended");
    assert.equal(agentMirrorValues(account(3), "x" as never).status, "retired", "Retired (3) é espelhado como retired (não como suspended)");
    assert.equal(agentMirrorValues(account(9), "x" as never).status, "pending");
  });

  it("cenário: suspenso pela plataforma, o evento da cadeia reativa status mas o agente segue indisponível", () => {
    // Linha do banco: status espelhado "active" e platformStatus "suspended" (kill switch).
    let row = { status: "active", platformStatus: PLATFORM_SUSPENDED };
    // Evento UsageRecorded/LicensePurchased: o indexador aplica o espelho (sem platformStatus).
    row = { ...row, ...agentMirrorValues(account(1), "x" as never) };
    assert.equal(row.platformStatus, PLATFORM_SUSPENDED);
    assert.equal(agentIsAvailable(row), false);
  });
});

describe("memória: só com licença ou sessão aberta", () => {
  it("regra de acesso", () => {
    assert.equal(canUseMemory({ licensed: false, openSession: false }), false);
    assert.equal(canUseMemory({ licensed: true, openSession: false }), true);
    assert.equal(canUseMemory({ licensed: false, openSession: true }), true);
    assert.equal(canUseMemory({ licensed: true, openSession: true }), true);
  });
});

describe("ids e slugs", () => {
  it("isAgentId: 32 hex minúsculos", () => {
    assert.equal(isAgentId("0123456789abcdef0123456789abcdef"), true);
    assert.equal(isAgentId("0123456789ABCDEF0123456789abcdef"), false);
    assert.equal(isAgentId("frontend-react"), false);
    assert.equal(isAgentId("0123456789abcdef0123456789abcde"), false);
    assert.equal(AGENT_ID_RE.test("g123456789abcdef0123456789abcdef"), false);
  });

  it("slugProblem explica o motivo", () => {
    assert.equal(slugProblem("frontend-react"), null);
    assert.match(slugProblem("0123456789abcdef0123456789abcdef")!, /format of an id/);
    assert.match(slugProblem("Ab")!, /3 to 40/);
    assert.match(slugProblem("Com Espaço")!, /lowercase/);
  });

  it("versionProblem: numérica, sem pré-lançamento, até 16 bytes", () => {
    assert.equal(versionProblem("1.2.3"), null);
    assert.match(versionProblem("1.2")!, /MAJOR\.MINOR\.PATCH/);
    assert.match(versionProblem("1.2.3-rc1")!, /MAJOR\.MINOR\.PATCH/);
    assert.match(versionProblem("1234567.1234567.12345")!, /16 bytes/);
  });
});

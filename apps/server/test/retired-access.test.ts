import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/http.js";
import {
  agentCanServe,
  agentIsAvailable,
  assertAgentCanServe,
  RETIRED_TEXT,
  servePolicy,
  trialAllowed,
  UNAVAILABLE_TEXT,
  type AccessKind,
} from "../src/runtime/availability.js";

// Solver aposentado (on-chain Retired = "retired"): licença vitalícia e garantia aberta continuam; teste grátis e quem
// não tem direito, não. Suspenso (cadeia ou plataforma) corta tudo. Regras puras, sem banco.

const ok = (status: string, platformStatus = "active") => ({ status, platformStatus });
const KINDS: AccessKind[] = ["license", "guarantee", "trial", "none"];

describe("servePolicy / agentCanServe", () => {
  it("retired com licença ou garantia aberta serve", () => {
    assert.equal(servePolicy(ok("retired")), "paid_only");
    assert.equal(agentCanServe(ok("retired"), "license"), true);
    assert.equal(agentCanServe(ok("retired"), "guarantee"), true);
  });

  it("retired sem direito (none) ou em teste grátis não serve", () => {
    assert.equal(agentCanServe(ok("retired"), "none"), false);
    assert.equal(agentCanServe(ok("retired"), "trial"), false);
    assert.equal(trialAllowed(ok("retired")), false);
  });

  it("suspended (cadeia) nunca serve, com qualquer direito", () => {
    for (const k of KINDS) assert.equal(agentCanServe(ok("suspended"), k), false, k);
    assert.equal(servePolicy(ok("suspended")), "closed");
  });

  it("suspensão da plataforma (kill switch) corta até o aposentado e o ativo", () => {
    for (const st of ["active", "retired", "suspended", "pending"]) {
      for (const k of KINDS) assert.equal(agentCanServe(ok(st, "suspended"), k), false, `${st}/${k}`);
    }
  });

  it("ativo serve todos os tipos de acesso; pending e status desconhecido não servem", () => {
    for (const k of KINDS) assert.equal(agentCanServe(ok("active"), k), true, k);
    assert.equal(trialAllowed(ok("active")), true);
    for (const st of ["pending", "missing", ""]) for (const k of KINDS) assert.equal(agentCanServe(ok(st), k), false, `${st}/${k}`);
  });
});

describe("vitrine e compra", () => {
  it("retired não está à venda (nem suspended, nem pending); só active e plataforma ativa", () => {
    assert.equal(agentIsAvailable(ok("retired")), false);
    assert.equal(agentIsAvailable(ok("suspended")), false);
    assert.equal(agentIsAvailable(ok("pending")), false);
    assert.equal(agentIsAvailable(ok("active")), true);
    assert.equal(agentIsAvailable(ok("active", "suspended")), false);
  });
});

describe("assertAgentCanServe", () => {
  const run = (a: ReturnType<typeof ok>, k: AccessKind) => {
    try {
      assertAgentCanServe(a, k);
      return null;
    } catch (e) {
      return e as HttpError;
    }
  };

  it("aposentado sem direito: 403 agent_unavailable com texto de aposentado; suspenso: texto de indisponível", () => {
    const retired = run(ok("retired"), "trial");
    assert.ok(retired instanceof HttpError);
    assert.equal(retired.status, 403);
    assert.equal(retired.code, "agent_unavailable");
    assert.equal(retired.message, RETIRED_TEXT);
    const susp = run(ok("suspended"), "license");
    assert.ok(susp instanceof HttpError);
    assert.equal(susp.message, UNAVAILABLE_TEXT);
  });

  it("aposentado com licença ou garantia: não lança", () => {
    assert.equal(run(ok("retired"), "license"), null);
    assert.equal(run(ok("retired"), "guarantee"), null);
  });
});

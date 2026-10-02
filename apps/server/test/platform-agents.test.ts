import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  assertNotPlatformAgent,
  isPlatformAgent,
  isPlatformAgentRow,
  isPlatformPair,
  PLATFORM_AGENTS,
  PLATFORM_AGENT_IDS,
  PLATFORM_NOT_FOR_SALE_CODE,
  platformVerdict,
} from "../src/runtime/platform-agents.js";
import { paidAccessLine } from "../src/runtime/access-rules.js";
import { agentCanServe } from "../src/runtime/availability.js";

// Solvers da plataforma (PACKAGE_SPEC.md 4.1 e 19): a lista do servidor é a autoridade. Sem env nem banco.

const CRIADOR = { slug: "criador-de-solvers", id: "c71ad0a50f750e75c71ad0a50f750e75" };
const OTHER_ID = "0123456789abcdef0123456789abcdef";

describe("PLATFORM_AGENTS", () => {
  it("o Criador de Solvers está na lista com o contrato fixo", () => {
    assert.deepEqual(PLATFORM_AGENTS.find((a) => a.slug === CRIADOR.slug), CRIADOR);
    assert.ok(PLATFORM_AGENT_IDS.includes(CRIADOR.id));
  });

  it("reconhece por id, por slug e por linha; o resto não é da plataforma", () => {
    assert.equal(isPlatformAgent(CRIADOR.id), true);
    assert.equal(isPlatformAgent(CRIADOR.slug), true);
    assert.equal(isPlatformAgentRow({ id: CRIADOR.id }), true);
    assert.equal(isPlatformAgent(OTHER_ID), false);
    assert.equal(isPlatformAgent("frontend-react"), false);
    assert.equal(isPlatformAgentRow({ id: OTHER_ID }), false);
  });

  it("a dupla slug+id precisa conferir inteira", () => {
    assert.equal(isPlatformPair(CRIADOR), true);
    assert.equal(isPlatformPair({ id: CRIADOR.id, slug: "outro-slug" }), false);
    assert.equal(isPlatformPair({ id: OTHER_ID, slug: CRIADOR.slug }), false);
  });
});

describe("platformVerdict: o campo do manifesto só vale se o servidor concordar", () => {
  it("pacote da plataforma com a dupla certa: platform true", () => {
    assert.deepEqual(platformVerdict({ ...CRIADOR, platform: true }, "agents"), { platform: true });
    // A lista é a autoridade: sem o campo, continua sendo da plataforma.
    assert.deepEqual(platformVerdict(CRIADOR, "agents"), { platform: true });
  });

  it("pacote comum da plataforma (fora da lista) não é platform", () => {
    assert.deepEqual(platformVerdict({ id: OTHER_ID, slug: "frontend-react" }, "agents"), { platform: false });
  });

  it("platform: true fora da lista é erro de carga, na pasta da plataforma e na de criadores", () => {
    for (const source of ["agents", "published"] as const) {
      const v = platformVerdict({ id: OTHER_ID, slug: "quero-ser-platform", platform: true }, source);
      assert.equal(v.platform, false);
      assert.match(v.error ?? "", /não está em PLATFORM_AGENTS/);
    }
  });

  it("pacote de criador não pode usar o slug nem o id da plataforma", () => {
    assert.match(platformVerdict(CRIADOR, "published").error ?? "", /só pode vir da pasta de pacotes da plataforma/);
    assert.match(platformVerdict({ id: OTHER_ID, slug: CRIADOR.slug }, "published").error ?? "", /reservado/);
    assert.match(platformVerdict({ id: CRIADOR.id, slug: "meu-slug" }, "published").error ?? "", /reservado/);
  });

  it("dupla trocada na pasta da plataforma também é recusada", () => {
    assert.match(platformVerdict({ id: CRIADOR.id, slug: "meu-slug" }, "agents").error ?? "", /não confere/);
  });
});

describe("assertNotPlatformAgent", () => {
  it("responde 409 platform_agent_not_for_sale para o Solver da plataforma", () => {
    assert.throws(
      () => assertNotPlatformAgent({ id: CRIADOR.id }),
      (e: unknown) => (e as { status?: number }).status === 409 && (e as { code?: string }).code === PLATFORM_NOT_FOR_SALE_CODE,
    );
    assert.equal(PLATFORM_NOT_FOR_SALE_CODE, "platform_agent_not_for_sale");
  });

  it("não atrapalha agente comum", () => {
    assert.doesNotThrow(() => assertNotPlatformAgent({ id: OTHER_ID }));
  });
});

describe("acesso platform: texto e disponibilidade", () => {
  it("a linha de acesso diz que é gratuito, sem licença", () => {
    assert.match(paidAccessLine("platform"), /gratuito/);
    assert.match(paidAccessLine("platform"), /Solver da plataforma/);
    assert.match(paidAccessLine("license"), /licença vitalícia/);
  });

  it("aposentado ainda serve o acesso platform (não é teste); suspenso corta tudo", () => {
    assert.equal(agentCanServe({ status: "active", platformStatus: "active" }, "platform"), true);
    assert.equal(agentCanServe({ status: "retired", platformStatus: "active" }, "platform"), true);
    assert.equal(agentCanServe({ status: "active", platformStatus: "suspended" }, "platform"), false);
    assert.equal(agentCanServe({ status: "retired", platformStatus: "active" }, "trial"), false);
  });
});

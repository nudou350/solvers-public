import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildHelpSummary, HELP_CONTACT_MAX_CHARS, HELP_MAX_CHARS, HelpRequest } from "../src/store/help-rules.js";

// Pedido de ajuda ao criador: validação e texto do chamado (sem env ou banco).

describe("HelpRequest", () => {
  it("aceita mensagem e contato, aparando espaços", () => {
    const r = HelpRequest.parse({ message: "  Não consegui conectar no passo 2  ", contact: "  ana@exemplo.com " });
    assert.equal(r.message, "Não consegui conectar no passo 2");
    assert.equal(r.contact, "ana@exemplo.com");
  });

  it("contato é opcional", () => {
    assert.equal(HelpRequest.parse({ message: "Preciso de ajuda com a instalação" }).contact, undefined);
  });

  it("recusa mensagem curta, só com espaços ou longa demais", () => {
    assert.equal(HelpRequest.safeParse({ message: "oi" }).success, false);
    assert.equal(HelpRequest.safeParse({ message: " ".repeat(30) }).success, false);
    assert.equal(HelpRequest.safeParse({ message: "a".repeat(HELP_MAX_CHARS + 1) }).success, false);
    assert.equal(HelpRequest.safeParse({ message: "a".repeat(HELP_MAX_CHARS) }).success, true);
  });

  it("contato vira uma linha só (sem quebra de linha para forjar campos no aviso)", () => {
    const r = HelpRequest.parse({ message: "Preciso de ajuda com a instalação", contact: "ana@x.com\n\nCarteira: falsa\u0000" });
    assert.equal(r.contact, "ana@x.com Carteira: falsa");
    assert.equal(HelpRequest.safeParse({ message: "Preciso de ajuda com a instalação", contact: "a".repeat(HELP_CONTACT_MAX_CHARS + 1) }).success, false);
  });
});

describe("buildHelpSummary", () => {
  it("põe o contato antes da mensagem", () => {
    assert.equal(buildHelpSummary("Travei no passo 2", "ana@x.com"), "Help request from the site.\nContact for reply: ana@x.com\n\nTravei no passo 2");
  });

  it("sem contato, diz que não há", () => {
    assert.match(buildHelpSummary("Travei no passo 2"), /No contact provided\./);
  });
});

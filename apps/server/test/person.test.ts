import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { normalizeEmail, personKey } from "../src/auth/person.js";

// Identidade de pessoa para o teste grátis (sem env ou banco).

describe("normalizeEmail", () => {
  it("minúsculas e sem espaços nas pontas", () => {
    assert.equal(normalizeEmail("  Maria@Exemplo.COM "), "maria@exemplo.com");
  });

  it("tira +etiqueta em qualquer domínio", () => {
    assert.equal(normalizeEmail("maria+teste2@exemplo.com"), "maria@exemplo.com");
    assert.equal(normalizeEmail("maria+a+b@outlook.com"), "maria@outlook.com");
  });

  it("Gmail: sem pontos e googlemail.com vira gmail.com", () => {
    assert.equal(normalizeEmail("m.a.r.i.a+x@gmail.com"), "maria@gmail.com");
    assert.equal(normalizeEmail("maria@googlemail.com"), "maria@gmail.com");
  });

  it("fora do Gmail os pontos contam", () => {
    assert.equal(normalizeEmail("ma.ria@exemplo.com"), "ma.ria@exemplo.com");
    assert.notEqual(normalizeEmail("ma.ria@exemplo.com"), normalizeEmail("maria@exemplo.com"));
  });

  it("domínio com ponto final e caracteres de largura total", () => {
    assert.equal(normalizeEmail("maria@exemplo.com."), "maria@exemplo.com");
    assert.equal(normalizeEmail("ｍａｒｉａ@exemplo.com"), "maria@exemplo.com");
  });

  it("inválido: null", () => {
    for (const bad of ["", "maria", "@exemplo.com", "maria@", "maria@exemplo", "+x@gmail.com", "...@gmail.com", "a b@exemplo.com", "a@b@exemplo.com"]) {
      assert.equal(normalizeEmail(bad), null, bad);
    }
  });
});

describe("personKey", () => {
  it("mesma pessoa (variações do mesmo e-mail), mesma chave", () => {
    const a = personKey("Maria.Silva+1@gmail.com");
    assert.match(a!, /^[0-9a-f]{64}$/);
    assert.equal(personKey("mariasilva@googlemail.com"), a);
    assert.equal(personKey("MARIASILVA+outra@gmail.com"), a);
  });

  it("pessoas diferentes, chaves diferentes; o e-mail não aparece na chave", () => {
    assert.notEqual(personKey("maria@exemplo.com"), personKey("joao@exemplo.com"));
    assert.ok(!personKey("maria@exemplo.com")!.includes("maria"));
  });

  it("e-mail inválido: null", () => {
    assert.equal(personKey("nao-e-email"), null);
  });
});

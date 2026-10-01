import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { sha256Hex } from "../src/lib/crypto.js";
import { chooseReviewLicense, resolvePublishedText, textMatchesHash } from "../src/store/review-rules.js";

// Avaliações: o texto off-chain só vale se o sha256 dele é o hash confirmado on-chain (sem env ou banco).

const h = sha256Hex;

describe("textMatchesHash", () => {
  it("bate só com o mesmo texto", () => {
    assert.equal(textMatchesHash("ótimo", h("ótimo")), true);
    assert.equal(textMatchesHash("ótimo!", h("ótimo")), false);
    assert.equal(textMatchesHash("", h("")), true);
  });
});

describe("resolvePublishedText (syncReview)", () => {
  it("publica o rascunho do mesmo hash", () => {
    assert.equal(resolvePublishedText(h("versão B"), ["versão B", "versão A"]), "versão B");
  });

  it("duas versões preparadas, a assinada é a A: publica A, nunca B", () => {
    // O rascunho B é o último preparado, mas a cadeia confirmou o hash de A.
    assert.equal(resolvePublishedText(h("A"), ["A", "B"]), "A");
    assert.equal(resolvePublishedText(h("A"), [undefined, "B"]), "");
  });

  it("sem rascunho mantém o texto já publicado se ele bate (mudou só a nota)", () => {
    assert.equal(resolvePublishedText(h("texto antigo"), [undefined, "texto antigo"]), "texto antigo");
  });

  it("nenhum candidato bate (avaliação feita direto na cadeia): texto vazio", () => {
    assert.equal(resolvePublishedText(h("algo que ninguém tem"), [undefined, "texto antigo"]), "");
    assert.equal(resolvePublishedText(h("x"), []), "");
  });

  it("avaliação sem texto: hash do vazio publica vazio", () => {
    assert.equal(resolvePublishedText(h(""), ["ignorado"]), "");
  });
});

describe("chooseReviewLicense (licença comprada usada)", () => {
  it("usa a primeira licença cuja avaliação ainda não foi gasta", () => {
    assert.deepEqual(chooseReviewLicense([{ id: "A", used: true }, { id: "B", used: false }], false), { kind: "use", asset: "B" });
    assert.deepEqual(chooseReviewLicense([{ id: "A", used: false }], false), { kind: "use", asset: "A" });
  });

  it("todas gastas pela dona anterior: all_used (erro claro, sem tentar a transação)", () => {
    assert.deepEqual(chooseReviewLicense([{ id: "A", used: true }], false), { kind: "all_used" });
  });

  it("todas gastas e a própria carteira já avaliou: segue para o programa recusar a avaliação repetida", () => {
    assert.deepEqual(chooseReviewLicense([{ id: "A", used: true }, { id: "B", used: true }], true), { kind: "use", asset: "A" });
  });

  it("sem licença: none", () => {
    assert.deepEqual(chooseReviewLicense([], false), { kind: "none" });
    assert.deepEqual(chooseReviewLicense([], true), { kind: "none" });
  });
});

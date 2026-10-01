import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PROGRAM_ERROR_MESSAGES, programErrorMessage } from "./program-errors.js";

// Mapa de erros do programa (mensagens em português) (a classificação pelo log e a simulação ficam em program-errors-log.test.ts).

/** Erros do programa lidos do FONTE gerado (não do dist): um erro novo exige texto mesmo antes de recompilar o cliente. */
function generatedErrors(): Array<{ constName: string; code: number }> {
  const src = readFileSync(new URL("../../solvers-client/src/generated/errors/solvers.ts", import.meta.url), "utf8");
  return [...src.matchAll(/export const (SOLVERS_ERROR__\w+) = 0x([0-9a-f]+);/gi)].map((m) => ({ constName: m[1]!, code: parseInt(m[2]!, 16) }));
}

describe("mensagens dos erros do programa", () => {
  it("TODO erro do cliente gerado tem mensagem em português (erro novo do programa obriga a escrever o texto)", () => {
    const errors = generatedErrors();
    assert.ok(errors.length >= 34, `esperava ao menos 34 erros no cliente gerado, achei ${errors.length}`);
    const semTexto = errors.filter((e) => !programErrorMessage(e.code)?.trim());
    assert.deepEqual(semTexto.map((e) => `${e.constName} (${e.code})`), [], "erros do programa sem mensagem em program-errors.ts");
  });

  it("não sobra mensagem de código que não existe mais no programa", () => {
    const codes = new Set(generatedErrors().map((e) => e.code));
    const orfas = Object.keys(PROGRAM_ERROR_MESSAGES).map(Number).filter((c) => !codes.has(c));
    assert.deepEqual(orfas, []);
  });

  it("mensagens simples: sem jargão e terminando em ponto", () => {
    for (const [code, msg] of Object.entries(PROGRAM_ERROR_MESSAGES)) {
      assert.match(msg, /[.!?]$/, `código ${code}`);
      assert.doesNotMatch(msg, /\b(stake|rent|escrow|bps|anchor|solana|blockchain|on-chain|PDA|signer)\b/i, `código ${code}: ${msg}`);
    }
  });

  it("as 8 mensagens que já existiam seguem iguais", () => {
    const byName = (n: string) => programErrorMessage([...generatedErrors()].find((e) => e.constName === n)!.code);
    assert.equal(byName("SOLVERS_ERROR__AGENT_NOT_ACTIVE"), "Este especialista ainda não está disponível para compra.");
    assert.equal(byName("SOLVERS_ERROR__PRICE_TOO_LOW"), "O preço está abaixo do mínimo da plataforma.");
    assert.equal(byName("SOLVERS_ERROR__NO_LICENSE"), "Você precisa ter a licença deste especialista para avaliar.");
    assert.equal(byName("SOLVERS_ERROR__NO_CREDITS"), "Seus créditos acabaram.");
    assert.equal(byName("SOLVERS_ERROR__BUYER_NOT_ELIGIBLE"), "Sua conta não pode abrir novas garantias no momento.");
    assert.equal(byName("SOLVERS_ERROR__DISPUTE_WINDOW_CLOSED"), "O prazo para contestar esta etapa já passou.");
    assert.equal(byName("SOLVERS_ERROR__AUTO_RELEASE_NOT_REACHED"), "Ainda não chegou o prazo de liberação automática.");
    assert.equal(byName("SOLVERS_ERROR__INVALID_MILESTONE_STATUS"), "Esta etapa não está no estado certo para esta ação.");
  });
});

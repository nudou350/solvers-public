import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { cloakWithdrawFee, formatUsdcBase, looksLikeSolanaAddress, parseUsdcInput, planPrivateWithdraw } from "./index.js";

const OWN = "5WFnp8GJnmcqZRNtXsusjYLyM5hXqtAwh4o2hFZhRFT8";
const DEST = "GmqxKCU9boFSPSnRQYtqpiLNrDpiwyqgA6CLsTUvtJ81";
const rich = { usdc: 10_000_000n, sol: 50_000_000n };

describe("cloak (saque privado)", () => {
  it("taxa = 0,45 + 0,3%: o saque de 2 USDC do spike na mainnet cobrou 0,456", () => {
    assert.equal(cloakWithdrawFee(2_000_000n), 456_000n);
    assert.equal(cloakWithdrawFee(1_000_000n), 453_000n);
    assert.equal(cloakWithdrawFee(100_000_000n), 750_000n);
  });

  it("lê o valor digitado (vírgula ou ponto, até 6 casas) e recusa o resto", () => {
    assert.equal(parseUsdcInput("2"), 2_000_000n);
    assert.equal(parseUsdcInput(" 2,5 "), 2_500_000n);
    assert.equal(parseUsdcInput("0.000001"), 1n);
    for (const bad of ["", "abc", "-1", "1e3", "1.0000001", "1,2,3", "0x10"]) assert.equal(parseUsdcInput(bad), null, bad);
  });

  it("formata em pt-BR", () => {
    assert.equal(formatUsdcBase(1_544_000n), "1,544");
    assert.equal(formatUsdcBase(2_000_000n), "2,00");
    assert.equal(formatUsdcBase(453_000n), "0,453");
  });

  it("endereço: só a forma (o kit confere o resto na tela)", () => {
    assert.equal(looksLikeSolanaAddress(DEST), true);
    assert.equal(looksLikeSolanaAddress("0OIl"), false);
    assert.equal(looksLikeSolanaAddress(""), false);
  });

  it("plano válido: recebe valor - taxa", () => {
    const p = planPrivateWithdraw({ amount: "2", destination: DEST, ownAddress: OWN, balances: rich });
    assert.deepEqual(p, { ok: true, amount: 2_000_000n, fee: 456_000n, net: 1_544_000n, destination: DEST });
  });

  it("recusa cada problema antes de gastar", () => {
    const base = { destination: DEST, ownAddress: OWN, balances: rich };
    const problem = (over: Partial<Parameters<typeof planPrivateWithdraw>[0]>) => {
      const p = planPrivateWithdraw({ amount: "2", ...base, ...over });
      return p.ok ? "ok" : p.problem;
    };
    assert.equal(problem({ amount: "x" }), "amount_invalid");
    assert.equal(problem({ amount: "0,99" }), "amount_too_small");
    assert.equal(problem({ amount: "1001" }), "amount_too_large");
    assert.equal(problem({ destination: "curto" }), "destination_invalid");
    assert.equal(problem({ destination: OWN }), "destination_same_as_wallet");
    assert.equal(problem({ balances: { usdc: 1_999_999n, sol: 50_000_000n } }), "usdc_insufficient");
    assert.equal(problem({ balances: { usdc: 10_000_000n, sol: 1_000n } }), "sol_insufficient");
    assert.equal(problem({ balances: null }), "ok");
  });
});

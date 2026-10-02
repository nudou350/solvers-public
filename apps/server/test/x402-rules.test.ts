import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildRequirements,
  canTransition,
  classifySettle,
  decideStalledMint,
  memoOf,
  MINT_RETRY_WINDOW_SECS,
  ORDER_STATUSES,
  orderExpired,
  priceBounds,
  priceInBounds,
  requirementsMismatch,
  TERMINAL,
  usdcToAtomic,
  type OrderStatus,
} from "../src/x402/rules.js";

// Regras puras da compra por x402 (docs/x402-agentes.md, 6.4 a 6.8): sem rede nem banco.

const ORDER = "ord_0123456789abcdef01234567";
const req = () =>
  buildRequirements({
    orderId: ORDER,
    price: 12_500_000n,
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    usdcMint: "4Ut3YnnVQjQ6UgedWFtd3PmDN1E25iZpq47YtoNYdTi3",
    custody: "7biEDybPZvac1isQuZ9U1vHfWTo4kXE8Mjixjjznz5Ks",
    feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
  });

describe("x402: máquina de estados da ordem", () => {
  it("estados finais não saem de onde estão", () => {
    for (const from of TERMINAL) for (const to of ORDER_STATUSES) assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
  });

  it("o caminho feliz e o de reembolso são permitidos", () => {
    const path: OrderStatus[] = ["created", "settling", "paid", "minting", "minted"];
    for (let i = 0; i < path.length - 1; i++) assert.equal(canTransition(path[i]!, path[i + 1]!), true);
    for (const [a, b] of [["paid", "refunding"], ["minting", "refunding"], ["refunding", "refunded"]] as const) assert.equal(canTransition(a, b), true);
  });

  it("não se pula etapa nem se reembolsa antes de pagar", () => {
    for (const [a, b] of [
      ["created", "paid"],
      ["created", "minting"],
      ["created", "refunding"],
      ["settling", "minted"],
      ["settling", "refunding"],
      ["paid", "minted"],
      ["paid", "refunded"],
      ["minting", "refunded"],
      ["refunded", "minted"],
      ["minted", "refunding"],
    ] as const) {
      assert.equal(canTransition(a, b), false, `${a} -> ${b}`);
    }
  });

  it("só `settling` volta a `created` (settle recusado) e só `minting` volta a `paid` (emissão refeita)", () => {
    for (const from of ORDER_STATUSES) assert.equal(canTransition(from, "created"), from === "settling", `${from} -> created`);
    for (const from of ORDER_STATUSES) assert.equal(canTransition(from, "paid"), from === "settling" || from === "minting", `${from} -> paid`);
  });
});

describe("x402: requisitos do pagamento", () => {
  it("monta o `accepts` com o preço travado, o memo da ordem e a custódia como destino", () => {
    const r = req();
    assert.equal(r.scheme, "exact");
    assert.equal(r.amount, "12500000");
    assert.equal(r.extra.memo, ORDER);
    assert.equal(r.payTo, "7biEDybPZvac1isQuZ9U1vHfWTo4kXE8Mjixjjznz5Ks");
  });

  it("o que bate exatamente é aceito", () => {
    assert.equal(requirementsMismatch({ ...req() }, req()), null);
  });

  for (const [field, patch] of [
    ["scheme", { scheme: "upto" }],
    ["network", { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" }],
    ["asset", { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }],
    ["payTo", { payTo: "11111111111111111111111111111111" }],
    ["amount", { amount: "12500001" }],
    ["amount", { amount: "1" }],
    ["memo", { extra: { memo: "ord_ffffffffffffffffffffffff" } }],
    ["memo", { extra: {} }],
  ] as const) {
    it(`recusa ${field} diferente (igualdade exata, não >=)`, () => {
      assert.equal(requirementsMismatch({ ...req(), ...patch }, req()), field);
    });
  }

  it("`accepted` ausente ou de tipo errado é recusado", () => {
    assert.equal(requirementsMismatch(null, req()), "accepted");
    assert.equal(requirementsMismatch(undefined, req()), "accepted");
  });

  it("amount numérico (não texto) não vale: a comparação é por texto", () => {
    assert.equal(requirementsMismatch({ ...req(), amount: 12500000 } as never, req()), "amount");
  });

  it("memoOf só aceita ids de ordem bem formados", () => {
    assert.equal(memoOf({ extra: { memo: ORDER } }), ORDER);
    for (const bad of [undefined, null, {}, { extra: null }, { extra: { memo: 5 } }, { extra: { memo: "ord_xyz" } }, { extra: { memo: `${ORDER}0` } }, { extra: { memo: ORDER.toUpperCase() } }]) {
      assert.equal(memoOf(bad as never), null);
    }
  });
});

describe("x402: limites de preço", () => {
  it("usdcToAtomic converte sem erro de ponto flutuante", () => {
    assert.equal(usdcToAtomic(5), 5_000_000n);
    assert.equal(usdcToAtomic(0.1 + 0.2), 300_000n);
    assert.equal(usdcToAtomic(12.345678), 12_345_678n);
    assert.throws(() => usdcToAtomic(-1));
    assert.throws(() => usdcToAtomic(Number.NaN));
  });

  it("o piso nunca fica abaixo do mínimo do programa", () => {
    assert.equal(priceBounds({ minUsdc: 1, maxUsdc: 100 }, 5_000_000n).min, 5_000_000n); // env mais baixo que o programa: vale o do programa
    assert.equal(priceBounds({ minUsdc: 8, maxUsdc: 100 }, 5_000_000n).min, 8_000_000n); // env mais alto: sobe o piso
    assert.equal(priceBounds({ minUsdc: 5, maxUsdc: 100 }, 5_000_000n).max, 100_000_000n);
  });

  it("piso e teto são inclusivos", () => {
    const b = priceBounds({ minUsdc: 5, maxUsdc: 100 }, 5_000_000n);
    assert.equal(priceInBounds(4_999_999n, b), false);
    assert.equal(priceInBounds(5_000_000n, b), true);
    assert.equal(priceInBounds(100_000_000n, b), true);
    assert.equal(priceInBounds(100_000_001n, b), false);
  });
});

describe("x402: vencimento", () => {
  it("vence quando o prazo chega", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    assert.equal(orderExpired({ expiresAt: new Date("2026-10-02T12:00:01Z") }, now), false);
    assert.equal(orderExpired({ expiresAt: new Date("2026-10-02T12:00:00Z") }, now), true);
    assert.equal(orderExpired({ expiresAt: new Date("2026-10-02T11:59:59Z") }, now), true);
  });
});

describe("x402: resultado do settle", () => {
  it("sucesso, recusa conclusiva e resultado ambíguo", () => {
    assert.equal(classifySettle({ success: true, transaction: "sig" }), "settled");
    assert.equal(classifySettle({ success: false }), "failed");
    // Falhou mas citou uma transação: pode ter entrado.
    assert.equal(classifySettle({ success: false, transaction: "sig" }), "ambiguous");
    // Timeout/erro de rede: pode ter entrado.
    assert.equal(classifySettle({ thrown: true }), "ambiguous");
  });
});

describe("x402: emissão parada (quando reembolsar)", () => {
  const base = { ownedByPayer: false, paidAgeSecs: 30 };

  it("licença já no pagador, ou transação confirmada: cumprida (nunca reembolsa)", () => {
    assert.equal(decideStalledMint({ ...base, outcome: "unsent", ownedByPayer: true }), "fulfilled");
    assert.equal(decideStalledMint({ ...base, outcome: "pending", ownedByPayer: true }), "fulfilled");
    assert.equal(decideStalledMint({ ...base, outcome: "failed", ownedByPayer: true }), "fulfilled");
    assert.equal(decideStalledMint({ ...base, outcome: "confirmed" }), "fulfilled");
  });

  it("transação ainda em aberto nunca é reembolsada: retransmite a mesma", () => {
    assert.equal(decideStalledMint({ ...base, outcome: "pending", paidAgeSecs: MINT_RETRY_WINDOW_SECS * 10 }), "resume");
  });

  it("nunca enviada: refaz dentro do prazo e reembolsa depois dele", () => {
    assert.equal(decideStalledMint({ ...base, outcome: "unsent" }), "retry");
    assert.equal(decideStalledMint({ ...base, outcome: "unsent", paidAgeSecs: MINT_RETRY_WINDOW_SECS - 1 }), "retry");
    assert.equal(decideStalledMint({ ...base, outcome: "unsent", paidAgeSecs: MINT_RETRY_WINDOW_SECS }), "refund");
  });

  it("falhou ou expirou na rede: reembolsa", () => {
    assert.equal(decideStalledMint({ ...base, outcome: "failed" }), "refund");
    assert.equal(decideStalledMint({ ...base, outcome: "expired" }), "refund");
  });
});

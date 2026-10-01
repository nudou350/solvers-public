import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { TokenDelta } from "@solvers/chain";
import { effectiveFeeBps, splitByBps, splitFromDeltas } from "../src/indexer/amounts.js";
import { canApplyMilestoneStatus, closedEscrowStatus, escrowStatusFromMilestones, retirementPlan, staleDisputeDue } from "../src/indexer/escrow-status.js";
import { FRESH_TX_SECS, IndexerRetryableError, backoffSecs, escrowNotVisible, isFreshTx, isInfraError, listingNotVisible, MAX_ATTEMPTS } from "../src/indexer/retry-policy.js";

// Regras puras do indexador: valores executados, status do escrow fechado e política de novas tentativas.

const MINT = "MintUSDC";
const d = (account: string, owner: string | null, delta: bigint, mint = MINT): TokenDelta => ({ account: account as never, owner, mint, delta });

describe("valores executados (saldos de token)", () => {
  it("compra: bruto sai do comprador, taxa chega na tesouraria, o resto vai ao criador", () => {
    const split = splitFromDeltas([d("buyerAta", "buyer", -10_000_000n), d("treasuryAta", "treasury", 1_000_000n), d("creatorAta", "creator", 9_000_000n)], MINT, "buyer", "treasuryAta");
    assert.deepEqual(split, { gross: 10_000_000n, fee: 1_000_000n, creatorAmount: 9_000_000n });
  });

  it("taxa zero: tesouraria sem variação, tudo ao criador", () => {
    const split = splitFromDeltas([d("buyerAta", "buyer", -5_000_000n), d("creatorAta", "creator", 5_000_000n)], MINT, "buyer", "treasuryAta");
    assert.deepEqual(split, { gross: 5_000_000n, fee: 0n, creatorAmount: 5_000_000n });
  });

  it("etapa de garantia: o pagador é o cofre (dono = PDA do escrow)", () => {
    const split = splitFromDeltas([d("vault", "escrowPda", -3_000_000n), d("treasuryAta", "treasury", 300_000n), d("creatorAta", "creator", 2_700_000n)], MINT, "escrowPda", "treasuryAta");
    assert.deepEqual(split, { gross: 3_000_000n, fee: 300_000n, creatorAmount: 2_700_000n });
  });

  it("ignora outros mints e devolve null quando não há pagamento nos saldos", () => {
    assert.equal(splitFromDeltas([d("buyerAta", "buyer", -10n, "OutroMint")], MINT, "buyer", "treasuryAta"), null);
    assert.equal(splitFromDeltas([], MINT, "buyer", "treasuryAta"), null);
    // taxa maior que o pago é incoerente: não inventa valores
    assert.equal(splitFromDeltas([d("buyerAta", "buyer", -10n), d("treasuryAta", "treasury", 20n)], MINT, "buyer", "treasuryAta"), null);
  });

  it("sem a conta da tesouraria (config não carregada): null, nunca fee=0 com o bruto para o criador", () => {
    const deltas = [d("buyerAta", "buyer", -10_000_000n), d("creatorAta", "creator", 9_000_000n), d("treasuryAta", "treasury", 1_000_000n)];
    assert.equal(splitFromDeltas(deltas, MINT, "buyer", null), null);
  });

  it("splitByBps espelha fee_split do programa (taxa arredondada para baixo)", () => {
    assert.deepEqual(splitByBps(999_999n, 1000), { gross: 999_999n, fee: 99_999n, creatorAmount: 900_000n });
    assert.deepEqual(splitByBps(1_000_000n, 0), { gross: 1_000_000n, fee: 0n, creatorAmount: 1_000_000n });
  });

  it("effectiveFeeBps: usa a configurada se bater; senão a implícita no pagamento", () => {
    const split = { gross: 10_000_000n, fee: 500_000n, creatorAmount: 9_500_000n };
    assert.equal(effectiveFeeBps(split, 500), 500);
    // a taxa mudou depois da transação: vale o que foi realmente pago (5%), não a configurada agora (10%)
    assert.equal(effectiveFeeBps(split, 1000), 500);
    assert.equal(effectiveFeeBps(split, null), 500);
  });
});

describe("escrow fechado: status pelo evento da etapa", () => {
  it("recalcula como o refresh_status do programa", () => {
    assert.equal(escrowStatusFromMilestones(["approved", "approved"]), "approved");
    assert.equal(escrowStatusFromMilestones(["refunded", "refunded"]), "refunded");
    assert.equal(escrowStatusFromMilestones(["approved", "refunded"]), "approved");
    assert.equal(escrowStatusFromMilestones(["approved", "disputed"]), "disputed");
    assert.equal(escrowStatusFromMilestones(["passed", "pending"]), "active");
  });

  it("escrow fechado é sempre final, mesmo com etapa irmã defasada no espelho", () => {
    assert.equal(closedEscrowStatus(["approved", "pending"]), "approved");
    assert.equal(closedEscrowStatus(["refunded", "refunded"]), "refunded");
  });

  it("evento atrasado não desfaz um desfecho", () => {
    assert.equal(canApplyMilestoneStatus("approved", "passed"), false);
    assert.equal(canApplyMilestoneStatus("refunded", "disputed"), false);
    assert.equal(canApplyMilestoneStatus("disputed", "approved"), true);
    assert.equal(canApplyMilestoneStatus("pending", "approved"), true);
    assert.equal(canApplyMilestoneStatus("pending", "passed"), true);
  });
});

describe("política de novas tentativas do indexador", () => {
  it("backoff exponencial de 30 s até 6 h", () => {
    assert.equal(backoffSecs(1), 30);
    assert.equal(backoffSecs(2), 60);
    assert.equal(backoffSecs(3), 120);
    assert.equal(backoffSecs(99), 6 * 3600);
    assert.ok(MAX_ATTEMPTS >= 10);
  });

  it("falha de infraestrutura não gasta tentativas; erro da transação gasta", () => {
    assert.equal(isInfraError(new IndexerRetryableError("x")), true);
    assert.equal(isInfraError(new Error("fetch failed")), true);
    assert.equal(isInfraError(new Error("HTTP 429 Too Many Requests")), true);
    assert.equal(isInfraError(new Error("licença abc ainda não visível no RPC")), true);
    assert.equal(isInfraError(Object.assign(new Error("x"), { cause: new Error("ECONNRESET") })), true);
    assert.equal(isInfraError(new Error("cannot read properties of undefined")), false);
    assert.equal(isInfraError(new Error("invalid input syntax")), false);
  });
});

describe("programa v2: cancelamento, disputa parada e aposentadoria", () => {
  it("cancel_undelivered: etapa pendente reembolsada conclui o escrow sem virar ganho", () => {
    // uma etapa paga e a outra cancelada: escrow concluído; todas canceladas: reembolsado
    assert.equal(escrowStatusFromMilestones(["approved", "refunded"]), "approved");
    assert.equal(escrowStatusFromMilestones(["refunded", "refunded"]), "refunded");
    // enquanto sobra etapa pendente, a tarefa segue ativa
    assert.equal(escrowStatusFromMilestones(["refunded", "pending"]), "active");
    assert.equal(canApplyMilestoneStatus("pending", "refunded"), true);
    assert.equal(canApplyMilestoneStatus("approved", "refunded"), true); // estado final vence; o programa impede na origem
    assert.equal(closedEscrowStatus(["refunded", "refunded"]), "refunded");
  });

  it("staleDisputeDue: só etapa nunca aprovada nos testes, prazo de entrega vencido e 7 dias de disputa", () => {
    const day = 86400;
    const disputedAt = 1_000_000;
    const m = { disputedAt, passedAt: 0, deliveryDeadline: disputedAt - day }; // prazo de entrega já vencido
    assert.equal(staleDisputeDue(m, disputedAt + 7 * day - 1), false); // antes dos 7 dias
    assert.equal(staleDisputeDue(m, disputedAt + 7 * day), true);
    assert.equal(staleDisputeDue({ ...m, disputedAt: 0n }, 9_999_999_999), false); // sem disputa
    assert.equal(staleDisputeDue({ ...m, disputedAt: BigInt(disputedAt), passedAt: 0n, deliveryDeadline: BigInt(disputedAt - day) }, disputedAt + 8 * day), true);
    // já passou nos testes: só o admin julga
    assert.equal(staleDisputeDue({ ...m, passedAt: disputedAt - 100 }, disputedAt + 30 * day), false);
    // prazo de entrega ainda não venceu (now > deadline é estrito)
    const late = { ...m, deliveryDeadline: disputedAt + 10 * day };
    assert.equal(staleDisputeDue(late, disputedAt + 8 * day), false);
    assert.equal(staleDisputeDue(late, disputedAt + 10 * day), false);
    assert.equal(staleDisputeDue(late, disputedAt + 10 * day + 1), true);
  });

  it("retirementPlan: aposenta o que a cadeia não mostra mais, sem mexer no que está vivo", () => {
    assert.equal(retirementPlan("active", "ok"), null);
    assert.deepEqual(retirementPlan("active", "gone"), { status: "refunded", closed: true });
    assert.deepEqual(retirementPlan("disputed", "legacy"), { status: "refunded", closed: true });
    assert.deepEqual(retirementPlan("pending", "legacy"), { status: "refunded", closed: true });
    assert.deepEqual(retirementPlan("approved", "gone"), { closed: true });
    assert.equal(retirementPlan("approved", "legacy"), null);
  });
});

describe("EscrowCreated: conta recém-criada ausente tenta de novo", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const at = (secsAgo: number) => new Date(now.getTime() - secsAgo * 1000);

  it("transação recente (ou sem horário de bloco) conta como recente: a ausência é do RPC, não do escrow", () => {
    assert.equal(isFreshTx(at(5), now), true);
    assert.equal(isFreshTx(at(FRESH_TX_SECS - 1), now), true);
    assert.equal(isFreshTx(null, now), true);
  });

  it("transação antiga: a conta pode ter sido fechada de verdade, então não fica na fila de tentativas", () => {
    assert.equal(isFreshTx(at(FRESH_TX_SECS), now), false);
    assert.equal(isFreshTx(at(3 * 86400), now), false);
  });

  it("o erro é o de nova tentativa e não gasta tentativas (infraestrutura), com o escrow na mensagem", () => {
    const e = escrowNotVisible("Esc1");
    assert.ok(e instanceof IndexerRetryableError);
    assert.match(e.message, /Esc1/);
    assert.equal(isInfraError(e), true);
  });
});

describe("anúncio de revenda ainda não visível", () => {
  it("é erro de infraestrutura (não gasta tentativas) e cita a licença", () => {
    const e = listingNotVisible("Asset1");
    assert.ok(e instanceof IndexerRetryableError);
    assert.match(e.message, /Asset1/);
    assert.equal(isInfraError(e), true);
  });
});

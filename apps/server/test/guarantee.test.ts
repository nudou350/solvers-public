import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { guaranteesText, guaranteeTaskText, milestoneDeliveryBlock, resolveEscrowId, splitCriteria, type GuaranteeTask } from "../src/runtime/guarantee-text.js";
import {
  cancelUndeliveredBlock,
  canCancelUndelivered,
  DEFAULT_DELIVERY_DAYS,
  deliveryDeadlineFrom,
  deliveryIntact,
  disputeDeadlineOf,
  DISPUTE_SLA_SECS,
  MAX_DELIVERY_DAYS,
  resolveDeliveryDays,
} from "../src/store/delivery-rules.js";

// Contexto da tarefa com garantia na ativação e regra do escrow_id (sem env ou banco).

const task = (id: string, title = "Formulário de login"): GuaranteeTask => ({
  id,
  agentId: "a1",
  title,
  description: "Preciso de um formulário com e-mail e senha.",
  deliveryDeadline: new Date("2099-01-15T12:00:00Z"),
  milestones: [
    { idx: 1, title: "Componente", criteria: "Valida e-mail; mostra erro", verify: "tests", status: "pending", amount: 12_000_000n },
    { idx: 0, title: "Plano", criteria: "Lista de casos de teste", verify: "manual", status: "passed", amount: 3_000_000n },
  ],
});

describe("guaranteeTaskText", () => {
  it("traz escrow_id, título, briefing, etapas em ordem e critérios", () => {
    const t = guaranteeTaskText(task("ESC1"));
    assert.match(t, /escrow_id: ESC1/);
    assert.match(t, /Formulário de login/);
    assert.match(t, /Preciso de um formulário/);
    assert.ok(t.indexOf("milestone=0") < t.indexOf("milestone=1"));
    assert.match(t, /Step 1 \(milestone=0\): Plano \[manual review; 3 USDC; passed the check/);
    assert.match(t, /\* Valida e-mail/);
    assert.match(t, /\* mostra erro/);
  });

  it("splitCriteria separa por linha e ponto e vírgula", () => {
    assert.deepEqual(splitCriteria("a; b\nc\n\n"), ["a", "b", "c"]);
  });
});

describe("guaranteesText", () => {
  it("vazio sem tarefas; uma só sem aviso", () => {
    assert.equal(guaranteesText([]), "");
    const one = guaranteesText([task("ESC1")]);
    assert.match(one, /escrow_id: ESC1/);
    assert.doesNotMatch(one, /ATENÇÃO/);
  });

  it("mais de uma: aviso para informar o escrow_id e o detalhe de todas", () => {
    const t = guaranteesText([task("ESC1", "Primeira"), task("ESC2", "Segunda")]);
    assert.match(t, /ATTENTION.*2 open guaranteed tasks.*escrow_id/);
    assert.match(t, /escrow_id: ESC1/);
    assert.match(t, /escrow_id: ESC2/);
    assert.match(t, /Primeira/);
    assert.match(t, /Segunda/);
  });
});

describe("resolveEscrowId (submit_deliverable)", () => {
  const A = task("A", "Tarefa A");
  const B = task("B", "Tarefa B");

  it("uma só aberta: omitido usa ela; informado igual passa", () => {
    assert.deepEqual(resolveEscrowId({ sessionEscrowId: "A", open: [A] }), { escrowId: "A", rebind: false });
    assert.deepEqual(resolveEscrowId({ sessionEscrowId: "A", given: "A", open: [A] }), { escrowId: "A", rebind: false });
    assert.deepEqual(resolveEscrowId({ open: [A] }), { escrowId: "A", rebind: false });
  });

  it("sessão presa em A, B é a única aberta e a IA omite: usa B e troca a sessão", () => {
    assert.deepEqual(resolveEscrowId({ sessionEscrowId: "A", open: [B] }), { escrowId: "B", rebind: true });
  });

  it("mais de uma aberta: id omitido é erro que lista as tarefas (nunca usa a da sessão)", () => {
    assert.throws(
      () => resolveEscrowId({ sessionEscrowId: "A", open: [B, A] }),
      (e: unknown) => e instanceof Error && /2 open guaranteed tasks/.test(e.message) && /Tarefa A \(escrow_id: A\)/.test(e.message) && /Tarefa B \(escrow_id: B\)/.test(e.message),
    );
    assert.throws(() => resolveEscrowId({ open: [A, B] }), /pass the escrow_id/);
  });

  it("id informado entre as abertas é aceito, mesmo com a sessão presa em outra (troca a sessão)", () => {
    assert.deepEqual(resolveEscrowId({ sessionEscrowId: "A", given: "B", open: [B, A] }), { escrowId: "B", rebind: true });
    assert.deepEqual(resolveEscrowId({ sessionEscrowId: "A", given: "A", open: [B, A] }), { escrowId: "A", rebind: false });
  });

  it("sessão de licença (sem escrowId na sessão): informa ou usa a única, sem trocar sessão", () => {
    assert.deepEqual(resolveEscrowId({ given: "B", open: [B, A] }), { escrowId: "B", rebind: false });
    assert.deepEqual(resolveEscrowId({ open: [B] }), { escrowId: "B", rebind: false });
  });

  it("id fora das abertas é recusado; sem nenhuma aberta também", () => {
    assert.throws(() => resolveEscrowId({ given: "X", open: [A] }), /not among this specialist's open tasks/);
    assert.throws(() => resolveEscrowId({ given: "X", open: [] }), /is not open/);
    assert.throws(() => resolveEscrowId({ open: [] }), /has no open guaranteed task/);
  });
});

describe("deliveryIntact (download da entrega aprovada)", () => {
  it("só libera com arquivos e hash igual ao aprovado", () => {
    assert.equal(deliveryIntact(2, "abc", "abc"), true);
    assert.equal(deliveryIntact(2, "abc", "abd"), false);
    assert.equal(deliveryIntact(0, "abc", "abc"), false);
    assert.equal(deliveryIntact(2, "abc", null), false);
  });
});

describe("prazo de entrega no texto da IA", () => {
  it("mostra o prazo; vencido avisa, mas não bloqueia nada; sem prazo (tarefa antiga) não mostra", () => {
    assert.match(guaranteeTaskText(task("E")), /Delivery deadline: 2099-01-15/);
    assert.doesNotMatch(guaranteeTaskText(task("E")), /OVERDUE/);
    assert.match(guaranteeTaskText({ ...task("E"), deliveryDeadline: new Date("2020-01-01T00:00:00Z") }), /OVERDUE/);
    assert.doesNotMatch(guaranteeTaskText({ ...task("E"), deliveryDeadline: null }), /Delivery deadline/);
  });
});

describe("milestoneDeliveryBlock", () => {
  it("etapa cancelada/reembolsada ou inexistente é recusada com mensagem clara; o resto segue (o programa decide o prazo)", () => {
    const t = { ...task("E"), milestones: [...task("E").milestones, { idx: 2, title: "Extra", criteria: "x", verify: "tests", status: "refunded", amount: 1n }] };
    assert.match(milestoneDeliveryBlock(t, 2)!, /canceled or refunded/);
    assert.match(milestoneDeliveryBlock(t, 4)!, /has no step/);
    assert.equal(milestoneDeliveryBlock(t, 1), null);
    assert.equal(milestoneDeliveryBlock({ ...t, deliveryDeadline: new Date("2020-01-01T00:00:00Z") }, 1), null);
  });
});

describe("resolveDeliveryDays", () => {
  it("ausente ou 0 vale 14; 1 a 60 passam", () => {
    assert.equal(resolveDeliveryDays(undefined), DEFAULT_DELIVERY_DAYS);
    assert.equal(resolveDeliveryDays(0), 14);
    assert.equal(resolveDeliveryDays(1), 1);
    assert.equal(resolveDeliveryDays(MAX_DELIVERY_DAYS), 60);
  });
  it("61, negativo e fracionado são recusados com mensagem em inglês", () => {
    for (const d of [61, -1, 2.5, Number.NaN]) assert.throws(() => resolveDeliveryDays(d), /between 1 and 60 days/);
  });
  it("deliveryDeadlineFrom soma dias", () => {
    assert.equal(deliveryDeadlineFrom(new Date("2026-01-01T00:00:00Z"), 14).toISOString(), "2026-01-15T00:00:00.000Z");
  });
});

describe("disputa e cancelamento por atraso", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  const past = new Date("2026-01-20T00:00:00Z");
  const future = new Date("2026-02-10T12:00:00Z");

  it("disputeDeadline: nulo sem disputa ou se a etapa já passou nos testes (só o admin julga)", () => {
    assert.equal(DISPUTE_SLA_SECS, 7 * 86400);
    assert.equal(disputeDeadlineOf({ disputedAt: null, passedAt: null }, past), null);
    assert.equal(disputeDeadlineOf({ disputedAt: new Date("2026-01-01T00:00:00Z"), passedAt: new Date("2025-12-31T00:00:00Z") }, past), null);
  });

  it("disputeDeadline: etapa que nunca passou = o mais tarde entre disputedAt + 7 dias e o prazo de entrega", () => {
    const disputedAt = new Date("2026-01-01T00:00:00Z");
    // prazo de entrega antes do SLA: vale disputedAt + 7 dias
    assert.equal(disputeDeadlineOf({ disputedAt, passedAt: null }, new Date("2025-12-30T00:00:00Z"))!.toISOString(), "2026-01-08T00:00:00.000Z");
    // prazo de entrega depois do SLA: vale o prazo de entrega
    assert.equal(disputeDeadlineOf({ disputedAt, passedAt: null }, new Date("2026-01-20T00:00:00Z"))!.toISOString(), "2026-01-20T00:00:00.000Z");
    // tarefa antiga sem prazo de entrega: só o SLA
    assert.equal(disputeDeadlineOf({ disputedAt, passedAt: null }, null)!.toISOString(), "2026-01-08T00:00:00.000Z");
  });

  it("canCancelUndelivered: etapa pendente, aberta e prazo vencido", () => {
    assert.equal(canCancelUndelivered({ closed: false, deliveryDeadline: past }, { status: "pending" }, now), true);
    assert.equal(canCancelUndelivered({ closed: false, deliveryDeadline: future }, { status: "pending" }, now), false);
    assert.equal(canCancelUndelivered({ closed: false, deliveryDeadline: past }, { status: "passed" }, now), false);
    assert.equal(canCancelUndelivered({ closed: true, deliveryDeadline: past }, { status: "pending" }, now), false);
    assert.equal(canCancelUndelivered({ closed: false, deliveryDeadline: null }, { status: "pending" }, now), false);
  });

  it("cancelUndeliveredBlock: null quando pode; mensagens claras (com a data) quando não", () => {
    assert.equal(cancelUndeliveredBlock({ closed: false, deliveryDeadline: past }, { status: "pending" }, now), null);
    assert.match(cancelUndeliveredBlock({ closed: false, deliveryDeadline: future }, { status: "pending" }, now)!, /only passes on 2026-02-10/);
    assert.match(cancelUndeliveredBlock({ closed: false, deliveryDeadline: past }, { status: "submitted" }, now)!, /hasn't been delivered yet/);
    assert.match(cancelUndeliveredBlock({ closed: true, deliveryDeadline: past }, { status: "pending" }, now)!, /already closed/);
    assert.match(cancelUndeliveredBlock({ closed: false, deliveryDeadline: null }, { status: "pending" }, now)!, /without a delivery deadline/);
  });
});

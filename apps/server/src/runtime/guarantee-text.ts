import { unitsToUsdc } from "@solvers/shared";
import { badRequest } from "../lib/http.js";
import { formatDeadline } from "../store/delivery-rules.js";

// Contexto da tarefa com garantia que o conector entrega à IA (activate_solver, list_open_guarantees)
// e regra do escrow_id de submit_deliverable. Funções puras (sem env/banco), testadas em test/guarantee.test.ts.

export type GuaranteeTask = {
  id: string;
  agentId: string;
  title: string;
  description: string;
  /** Prazo de entrega (nulo em tarefas criadas antes do programa v2). */
  deliveryDeadline: Date | null;
  milestones: { idx: number; title: string; criteria: string; verify: string; status: string; amount: bigint }[];
};

/** Critérios combinados de uma etapa, um por item. */
export function splitCriteria(criteria: string): string[] {
  return criteria
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STATUS_LABEL: Record<string, string> = {
  pending: "waiting for delivery",
  submitted: "delivery being checked",
  passed: "passed the check, waiting for the user",
  approved: "approved",
  disputed: "in dispute",
  refunded: "canceled or refunded (no longer accepts deliveries)",
};

function deadlineLines(t: GuaranteeTask): string[] {
  if (!t.deliveryDeadline) return [];
  const late = Date.now() > t.deliveryDeadline.getTime();
  return [
    `Delivery deadline: ${formatDeadline(t.deliveryDeadline)}${late ? " (OVERDUE: deliver as soon as possible; the user can already cancel the pending steps and get a refund)" : ""}.`,
    "",
  ];
}

/** Por que uma etapa não recebe entrega (null: siga; quem decide o resto é o verificador e o programa, inclusive prazo vencido). */
export function milestoneDeliveryBlock(t: GuaranteeTask, index: number): string | null {
  const m = t.milestones.find((x) => x.idx === index);
  if (!m) return `The task "${t.title}" has no step with milestone=${index}.`;
  if (m.status === "refunded") return `Step ${index + 1} of this task was canceled or refunded and no longer accepts deliveries.`;
  return null;
}

/** Bloco de texto com o necessário para fazer a tarefa e entregar (escrow_id, briefing, etapas e critérios). */
export function guaranteeTaskText(t: GuaranteeTask): string {
  const lines = [`## Guaranteed task: ${t.title}`, `escrow_id: ${t.id}`, "", "User briefing:", t.description.trim() || "(no description)", "", ...deadlineLines(t), "Agreed steps (deliver each one with submit_deliverable):"];
  for (const m of [...t.milestones].sort((a, b) => a.idx - b.idx)) {
    lines.push(`- Step ${m.idx + 1} (milestone=${m.idx}): ${m.title} [${m.verify === "manual" ? "manual review" : "automated tests"}; ${unitsToUsdc(m.amount)} USDC; ${STATUS_LABEL[m.status] ?? m.status}]`);
    for (const c of splitCriteria(m.criteria)) lines.push(`    * ${c}`);
  }
  return lines.join("\n");
}

/** Uma linha por tarefa: para a IA (ou o usuário) escolher qual é. */
export function guaranteeChoices(tasks: GuaranteeTask[]): string {
  return tasks.map((t) => `- ${t.title} (escrow_id: ${t.id})`).join("\n");
}

/**
 * Garantias abertas do especialista em texto. Com mais de uma, todas com detalhe (a IA precisa saber o que
 * cada uma pede) e a regra: informar o escrow_id em submit_deliverable.
 */
export function guaranteesText(tasks: GuaranteeTask[]): string {
  if (tasks.length === 0) return "";
  if (tasks.length === 1) return guaranteeTaskText(tasks[0]!);
  return [
    `ATTENTION: the user has ${tasks.length} open guaranteed tasks with this specialist. Find out with them which one this conversation is about (by title, never ask for the id) and always pass its escrow_id to submit_deliverable.`,
    "",
    tasks.map(guaranteeTaskText).join("\n\n"),
  ].join("\n");
}

export type EscrowChoice = {
  escrowId: string;
  /** O escrow_id da sessão de garantia mudou: gravar o novo no contexto da sessão. */
  rebind: boolean;
};

/**
 * escrow_id do submit_deliverable, sobre as garantias abertas do usuário com o especialista (`open`).
 * - informado: precisa estar entre as abertas (aceito mesmo que a sessão esteja presa a outra; aí troca o da sessão);
 * - omitido com mais de uma aberta: erro listando as tarefas (nunca adivinha);
 * - omitido com uma só: ela (a sessão de garantia passa a apontar para ela se estava em outra);
 * - nenhuma aberta: erro.
 */
export function resolveEscrowId(input: { sessionEscrowId?: unknown; given?: string; open: GuaranteeTask[] }): EscrowChoice {
  const fromSession = typeof input.sessionEscrowId === "string" ? input.sessionEscrowId : undefined;
  const { open, given } = input;
  const choose = (escrowId: string): EscrowChoice => ({ escrowId, rebind: !!fromSession && fromSession !== escrowId });
  if (given) {
    if (!open.some((t) => t.id === given)) {
      throw badRequest(
        open.length === 0
          ? "This guaranteed task is not open for this specialist."
          : `This guaranteed task is not among this specialist's open tasks. Open tasks:\n${guaranteeChoices(open)}`,
      );
    }
    return choose(given);
  }
  if (open.length === 0) throw badRequest("The user has no open guaranteed task with this specialist.");
  if (open.length > 1) {
    throw badRequest(`There are ${open.length} open guaranteed tasks: pass the escrow_id of the right one (confirm with the user by title).\n${guaranteeChoices(open)}`);
  }
  return choose(open[0]!.id);
}

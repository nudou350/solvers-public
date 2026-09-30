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
  pending: "aguardando entrega",
  submitted: "entrega em verificação",
  passed: "passou na verificação, aguardando o usuário",
  approved: "aprovada",
  disputed: "em disputa",
  refunded: "cancelada ou reembolsada (não recebe mais entrega)",
};

function deadlineLines(t: GuaranteeTask): string[] {
  if (!t.deliveryDeadline) return [];
  const late = Date.now() > t.deliveryDeadline.getTime();
  return [
    `Prazo de entrega: ${formatDeadline(t.deliveryDeadline)}${late ? " (VENCIDO: entregue o quanto antes; o usuário já pode cancelar as etapas pendentes e receber de volta)" : ""}.`,
    "",
  ];
}

/** Por que uma etapa não recebe entrega (null: siga; quem decide o resto é o verificador e o programa, inclusive prazo vencido). */
export function milestoneDeliveryBlock(t: GuaranteeTask, index: number): string | null {
  const m = t.milestones.find((x) => x.idx === index);
  if (!m) return `A tarefa "${t.title}" não tem a etapa milestone=${index}.`;
  if (m.status === "refunded") return `A etapa ${index + 1} desta tarefa foi cancelada ou reembolsada e não recebe mais entrega.`;
  return null;
}

/** Bloco de texto com o necessário para fazer a tarefa e entregar (escrow_id, briefing, etapas e critérios). */
export function guaranteeTaskText(t: GuaranteeTask): string {
  const lines = [`## Tarefa com garantia: ${t.title}`, `escrow_id: ${t.id}`, "", "Briefing do usuário:", t.description.trim() || "(sem descrição)", "", ...deadlineLines(t), "Etapas combinadas (entregue cada uma com submit_deliverable):"];
  for (const m of [...t.milestones].sort((a, b) => a.idx - b.idx)) {
    lines.push(`- Etapa ${m.idx + 1} (milestone=${m.idx}): ${m.title} [${m.verify === "manual" ? "revisão manual" : "testes automáticos"}; ${unitsToUsdc(m.amount)} USDC; ${STATUS_LABEL[m.status] ?? m.status}]`);
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
    `ATENÇÃO: o usuário tem ${tasks.length} tarefas com garantia abertas com este especialista. Descubra com ele qual é a desta conversa (pelo título, nunca peça o id) e sempre informe o escrow_id dela em submit_deliverable.`,
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
          ? "Esta tarefa com garantia não está aberta para este especialista."
          : `Esta tarefa com garantia não está entre as abertas deste especialista. Abertas:\n${guaranteeChoices(open)}`,
      );
    }
    return choose(given);
  }
  if (open.length === 0) throw badRequest("O usuário não tem tarefa com garantia aberta com este especialista.");
  if (open.length > 1) {
    throw badRequest(`Há ${open.length} tarefas com garantia abertas: informe o escrow_id da tarefa certa (confirme com o usuário pelo título).\n${guaranteeChoices(open)}`);
  }
  return choose(open[0]!.id);
}

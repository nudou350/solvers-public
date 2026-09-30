import { getBase64Encoder, type Address } from "@solana/kit";
import * as gen from "@solvers/client";

/** Eventos emitidos pelo programa (INSTRUCTIONS.md 4.4), já decodificados. */
export type SolversEvent =
  | { name: "AgentRegistered"; data: gen.AgentRegisteredEvent }
  | { name: "AgentStatusChanged"; data: gen.AgentStatusChangedEvent }
  | { name: "AgentVersionUpdated"; data: gen.AgentVersionUpdatedEvent }
  | { name: "EvalUpdated"; data: gen.EvalUpdatedEvent }
  | { name: "StakeSlashed"; data: gen.StakeSlashedEvent }
  | { name: "LicensePurchased"; data: gen.LicensePurchasedEvent }
  | { name: "CreditsBought"; data: gen.CreditsBoughtEvent }
  | { name: "CreditConsumed"; data: gen.CreditConsumedEvent }
  | { name: "UsageRecorded"; data: gen.UsageRecordedEvent }
  | { name: "ReviewSubmitted"; data: gen.ReviewSubmittedEvent }
  | { name: "EscrowCreated"; data: gen.EscrowCreatedEvent }
  | { name: "MilestoneUpdated"; data: gen.MilestoneUpdatedEvent }
  | { name: "DisputeResolved"; data: gen.DisputeResolvedEvent };

const DECODERS: Array<[string, Uint8Array | ReadonlyUint8Array, (d: Uint8Array) => unknown]> = [
  ["AgentRegistered", gen.AGENT_REGISTERED_EVENT_DISCRIMINATOR, gen.parseAgentRegisteredEvent],
  ["AgentStatusChanged", gen.AGENT_STATUS_CHANGED_EVENT_DISCRIMINATOR, gen.parseAgentStatusChangedEvent],
  ["AgentVersionUpdated", gen.AGENT_VERSION_UPDATED_EVENT_DISCRIMINATOR, gen.parseAgentVersionUpdatedEvent],
  ["EvalUpdated", gen.EVAL_UPDATED_EVENT_DISCRIMINATOR, gen.parseEvalUpdatedEvent],
  ["StakeSlashed", gen.STAKE_SLASHED_EVENT_DISCRIMINATOR, gen.parseStakeSlashedEvent],
  ["LicensePurchased", gen.LICENSE_PURCHASED_EVENT_DISCRIMINATOR, gen.parseLicensePurchasedEvent],
  ["CreditsBought", gen.CREDITS_BOUGHT_EVENT_DISCRIMINATOR, gen.parseCreditsBoughtEvent],
  ["CreditConsumed", gen.CREDIT_CONSUMED_EVENT_DISCRIMINATOR, gen.parseCreditConsumedEvent],
  ["UsageRecorded", gen.USAGE_RECORDED_EVENT_DISCRIMINATOR, gen.parseUsageRecordedEvent],
  ["ReviewSubmitted", gen.REVIEW_SUBMITTED_EVENT_DISCRIMINATOR, gen.parseReviewSubmittedEvent],
  ["EscrowCreated", gen.ESCROW_CREATED_EVENT_DISCRIMINATOR, gen.parseEscrowCreatedEvent],
  ["MilestoneUpdated", gen.MILESTONE_UPDATED_EVENT_DISCRIMINATOR, gen.parseMilestoneUpdatedEvent],
  ["DisputeResolved", gen.DISPUTE_RESOLVED_EVENT_DISCRIMINATOR, gen.parseDisputeResolvedEvent],
];

type ReadonlyUint8Array = gen.AgentRegisteredEvent["agentId"];

function startsWith(data: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

/**
 * Extrai os eventos Anchor dos logs de uma transação.
 * Só considera "Program data:" emitido enquanto o nosso programa está no topo da pilha de
 * chamadas, para ignorar dados de outros programas chamados via CPI.
 */
export function parseEvents(logs: readonly string[], programId: Address): SolversEvent[] {
  const b64 = getBase64Encoder();
  const stack: string[] = [];
  const out: SolversEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith("Program data: ") || stack[stack.length - 1] !== programId) continue;
    let data: Uint8Array;
    try {
      data = Uint8Array.from(b64.encode(line.slice("Program data: ".length).trim()));
    } catch {
      continue;
    }
    for (const [name, disc, parse] of DECODERS) {
      if (startsWith(data, disc)) {
        out.push({ name, data: parse(data) } as SolversEvent);
        break;
      }
    }
  }
  return out;
}

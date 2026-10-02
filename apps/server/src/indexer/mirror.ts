import type { Address } from "@solvers/chain";
import type * as gen from "@solvers/client";
import { bytesToHexStr } from "../lib/crypto.js";

// Espelho banco <- conta on-chain do agente (puro, sem env/banco: testado em test/platform-status.test.ts).
// IMPORTANTE: este objeto NÃO pode conter `platformStatus`. O indexador reescreve estas colunas a cada evento
// (inclusive UsageRecorded e LicensePurchased); a suspensão da plataforma vive em outra coluna e sobrevive.

// Índice = enum `AgentStatus` on-chain (Pending, Active, Suspended, Retired). `Retired` (saída de stake pedida pelo criador)
// é "retired": sem venda nova, sem teste grátis e fora da vitrine, mas quem tem direito PAGO (licença vitalícia, garantia
// aberta) continua usando (runtime/availability.ts). `agents.status` é `text` sem CHECK nem enum no banco.
export const AGENT_STATUS = ["pending", "active", "suspended", "retired"] as const;

export function agentMirrorValues(a: gen.Agent, agentAddr: Address) {
  return {
    version: a.version,
    versionHash: bytesToHexStr(a.versionHash),
    price: a.price,
    pricePerUse: a.pricePerUse,
    royaltyBps: a.royaltyBps,
    evalScoreBps: a.evalScoreBps,
    evalHash: bytesToHexStr(a.evalHash),
    status: AGENT_STATUS[a.status] ?? "pending",
    totalSales: a.totalSales,
    verifiedUses: a.verifiedUses,
    ratingSum: a.ratingSum,
    ratingCount: a.ratingCount,
    disputesLost: a.disputesLost,
    stake: a.stake,
    onchainAddress: agentAddr,
    collectionAddress: a.collection,
    updatedAt: new Date(),
  };
}

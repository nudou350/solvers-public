import { z } from "zod";
import { Agent, Creator, Escrow, License, Review, UserReputation } from "./schemas.js";

// Extensões ao contrato para telas que o schema base não cobre.
// Nunca alteram os campos de Agent/Creator/...; vêm em objetos separados.

export const BeforeAfter = z.object({
  prompt: z.string(),
  withoutSolver: z.string(),
  withSolver: z.string(),
});

export const AgentVersion = z.object({
  version: z.string(),
  versionHash: z.string(),
  releasedAt: z.string(),
  notes: z.string(),
  evalScore: z.number().nullable(),
});

/** GET /api/agents/:slug */
export const AgentDetail = z.object({
  agent: Agent,
  creator: Creator,
  reviews: z.array(Review),
  beforeAfter: z.array(BeforeAfter),
  versions: z.array(AgentVersion),
  freeTrialUses: z.number(),
  priceBrl: z.number().nullable(),
  pricePerUseBrl: z.number().nullable(),
  resalePriceHistory: z.array(z.object({ date: z.string(), priceUsdc: z.number() })),
});

/** GET /api/creators/:id */
export const CreatorProfile = z.object({
  creator: Creator,
  agents: z.array(Agent),
});

/** GET /api/creator/dashboard */
export const CreatorDashboard = z.object({
  creator: Creator.nullable(),
  totals: z.object({
    sales: z.number(),
    uses: z.number(),
    salesRevenueUsdc: z.number(),
    royaltiesUsdc: z.number(),
    disputesOpened: z.number(),
    disputesLost: z.number(),
  }),
  agents: z.array(
    z.object({
      agentId: z.string(),
      name: z.string(),
      sales: z.number(),
      uses: z.number(),
      revenueUsdc: z.number(),
      disputes: z.number(),
    }),
  ),
  daily: z.array(z.object({ date: z.string(), sales: z.number(), uses: z.number(), revenueUsdc: z.number() })),
});

/** GET /api/connector */
export const ConnectorStatus = z.object({
  url: z.string(),
  authorizedClients: z.array(z.object({ clientName: z.string(), authorizedAt: z.string() })),
});

/** GET /api/me/profile */
export const Profile = z.object({
  wallet: z.string(),
  reputation: UserReputation,
  creator: Creator.nullable(),
  explorerUrl: z.string(),
  history: z.array(z.object({ kind: z.string(), label: z.string(), at: z.string(), signature: z.string().nullable() })),
});

/** GET /api/me/escrows/:id */
export const EscrowDetail = z.object({
  escrow: Escrow,
  agent: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  milestones: z.array(
    z.object({
      index: z.number(),
      amountUsdc: z.number(),
      passedAt: z.string().nullable(),
      autoReleaseAt: z.string().nullable(),
      previewUrl: z.string().nullable(),
      tests: z.object({ passed: z.number(), total: z.number(), mode: z.string() }).nullable(),
      criteria: z.array(z.string()),
      hasAcceptanceTests: z.boolean(),
      disputeCriterion: z.string().nullable(),
      downloadable: z.boolean(),
    }),
  ),
  explorerUrl: z.string(),
});

/** GET /api/market/listings (revenda é P2: dados simulados na demo) */
export const ResaleListing = z.object({
  license: License,
  agent: Agent,
  priceUsdc: z.number(),
  priceTrendPct: z.number(),
  simulated: z.boolean(),
});

/** Resposta dos endpoints /api/tx/*: transação serializada pronta para a carteira assinar. */
export const TxResponse = z.object({
  transaction: z.string(), // base64, já assinada pelo fee payer do servidor
  blockhash: z.string(),
  lastValidBlockHeight: z.number(),
  meta: z.record(z.unknown()).optional(),
});

/** Resultado do POST /api/tx/submit (o servidor transmite e aguarda confirmed). */
export const SubmitResponse = z.object({ signature: z.string(), status: z.enum(["confirmed", "failed"]), error: z.string().optional() });

export type BeforeAfter = z.infer<typeof BeforeAfter>;
export type AgentVersion = z.infer<typeof AgentVersion>;
export type AgentDetail = z.infer<typeof AgentDetail>;
export type CreatorProfile = z.infer<typeof CreatorProfile>;
export type CreatorDashboard = z.infer<typeof CreatorDashboard>;
export type ConnectorStatus = z.infer<typeof ConnectorStatus>;
export type Profile = z.infer<typeof Profile>;
export type TxResponse = z.infer<typeof TxResponse>;
export type EscrowDetail = z.infer<typeof EscrowDetail>;
export type ResaleListing = z.infer<typeof ResaleListing>;
export type SubmitResponse = z.infer<typeof SubmitResponse>;

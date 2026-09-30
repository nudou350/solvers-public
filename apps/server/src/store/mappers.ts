import type { Agent, Creator, Escrow, License, Milestone, Review, UserReputation } from "@solvers/shared";
import {
  averageRating,
  bpsToScore,
  creatorReputationScore,
  guaranteeLevel,
  reputationScore,
  unitsToUsdc,
} from "@solvers/shared";
import type { schema } from "../db/index.js";

type AgentRow = typeof schema.agents.$inferSelect;
type CreatorRow = typeof schema.creators.$inferSelect;
type LicenseRow = typeof schema.licenses.$inferSelect;
type ReviewRow = typeof schema.reviews.$inferSelect;
type EscrowRow = typeof schema.escrows.$inferSelect;
type MilestoneRow = typeof schema.milestones.$inferSelect;
type RepRow = typeof schema.userReputation.$inferSelect;

export type AgentExtras = { trend7d: number; resaleFloor: bigint | null };

export function toAgent(row: AgentRow, extras: AgentExtras): Agent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    creatorId: row.creatorId,
    version: row.version,
    versionHash: row.versionHash,
    priceUsdc: unitsToUsdc(row.price),
    pricePerUseUsdc: row.pricePerUse > 0n ? unitsToUsdc(row.pricePerUse) : null,
    userRating: averageRating(row.ratingSum, row.ratingCount),
    reviewsCount: row.ratingCount,
    verifiedUses: Number(row.verifiedUses),
    evalScore: bpsToScore(row.evalScoreBps),
    requirements: row.requirements,
    packageContents: row.packageContents,
    guaranteeAvailable: row.guaranteeAvailable,
    resaleFloorUsdc: extras.resaleFloor == null ? null : unitsToUsdc(extras.resaleFloor),
    trend7d: extras.trend7d,
  };
}

export type CreatorStats = { totalSales: number; avgRating: number; disputesLost: number; agentsPublished: number };

export function toCreator(row: CreatorRow, stats: CreatorStats): Creator {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    reputationScore: creatorReputationScore(stats.totalSales, stats.avgRating, stats.disputesLost),
    disputesLost: stats.disputesLost,
    agentsPublished: stats.agentsPublished,
  };
}

export function toLicense(row: LicenseRow): License {
  return {
    id: row.id,
    agentId: row.agentId,
    ownerWallet: row.ownerWallet,
    acquiredAt: row.acquiredAt.toISOString(),
    type: "permanent",
    creditsLeft: null,
    listedForResale: row.listedForResale,
    resalePriceUsdc: row.resalePrice == null ? null : unitsToUsdc(row.resalePrice),
  };
}

/** Créditos aparecem como uma "licença" do tipo credits (id estável por solver + carteira). */
export function creditsToLicense(row: typeof schema.credits.$inferSelect): License {
  return {
    id: `credits:${row.agentId}:${row.ownerWallet}`,
    agentId: row.agentId,
    ownerWallet: row.ownerWallet,
    acquiredAt: row.updatedAt.toISOString(),
    type: "credits",
    creditsLeft: row.remaining,
    listedForResale: false,
    resalePriceUsdc: null,
  };
}

export function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    agentId: row.agentId,
    authorWallet: row.authorWallet,
    rating: row.rating,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    verifiedPurchase: true,
  };
}

const MILESTONE_STATUS = new Set(["pending", "submitted", "passed", "approved", "disputed", "refunded"]);

export function toEscrow(row: EscrowRow, ms: MilestoneRow[]): Escrow {
  const milestones: Milestone[] = ms
    .sort((a, b) => a.idx - b.idx)
    .map((m) => ({
      title: m.title,
      criteria: m.criteria,
      status: (MILESTONE_STATUS.has(m.status) ? m.status : "pending") as Milestone["status"],
    }));
  const status = (["active", "approved", "disputed", "refunded"].includes(row.status) ? row.status : "active") as Escrow["status"];
  return {
    id: row.id,
    agentId: row.agentId,
    buyerWallet: row.buyerWallet,
    amountUsdc: unitsToUsdc(row.total),
    status,
    milestones,
    // Sem etapa aprovada nos testes ainda, não há prazo de liberação automática: string vazia.
    autoReleaseAt: row.autoReleaseAt ? row.autoReleaseAt.toISOString() : "",
  };
}

export function toReputation(wallet: string, row: RepRow | undefined): UserReputation {
  const purchases = row?.purchases ?? 0;
  const disputesLost = row?.disputesLost ?? 0;
  return {
    wallet,
    score: reputationScore(purchases, disputesLost),
    purchases,
    disputesLost,
    guaranteeLevel: guaranteeLevel(purchases, disputesLost),
  };
}

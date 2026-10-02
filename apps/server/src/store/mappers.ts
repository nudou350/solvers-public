import type { Agent, Creator, Escrow, ImageRef, License, Milestone, Review, UserReputation } from "@solvers/shared";
import {
  averageRating,
  bpsToScore,
  creatorReputationScore,
  guaranteeLevel,
  reputationScore,
  unitsToUsdc,
} from "@solvers/shared";
import type { schema } from "../db/index.js";
import { env } from "../env.js";
import { getPackage } from "../runtime/packages.js";
import { trialLimits } from "../runtime/trial.js";
import { supplyOfRow } from "./supply-rules.js";

type AgentRow = typeof schema.agents.$inferSelect;
type CreatorRow = typeof schema.creators.$inferSelect;
type LicenseRow = typeof schema.licenses.$inferSelect;
type ReviewRow = typeof schema.reviews.$inferSelect;
type EscrowRow = typeof schema.escrows.$inferSelect;
type MilestoneRow = typeof schema.milestones.$inferSelect;
type RepRow = typeof schema.userReputation.$inferSelect;

export type AgentExtras = { trend7d: number; resaleFloor: bigint | null; /** Licença do anúncio mais barato (o piso); null sem anúncio. */ resaleListingId?: string | null };

/** Garantia só para quem já provou: vendas e nota mínimas (GUARANTEE_MIN_SALES / GUARANTEE_MIN_RATING). */
export function guaranteeOffered(row: AgentRow): boolean {
  if (!row.guaranteeAvailable || !row.details.guaranteeTemplate) return false;
  if (Number(row.totalSales) < env.GUARANTEE_MIN_SALES) return false;
  // Média bruta (sem arredondar): 3,95 não conta como 4.
  if (env.GUARANTEE_MIN_RATING > 0 && (row.ratingCount === 0 || Number(row.ratingSum) / row.ratingCount < env.GUARANTEE_MIN_RATING)) return false;
  return true;
}

/** Data da primeira versão conhecida (manifest), ou do cadastro no banco. */
export function publishedAt(row: AgentRow): string {
  const dates = (row.details.versions ?? []).map((v) => Date.parse(v.releasedAt)).filter((t) => !Number.isNaN(t));
  return new Date(dates.length ? Math.min(...dates) : row.createdAt.getTime()).toISOString();
}

export function hasTrial(agentId: string): boolean {
  const pkg = getPackage(agentId);
  return !!pkg && trialLimits(pkg.manifest) !== null;
}

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
    // Teste grátis vem do manifest em disco, a mesma fonte que o conector usa para aplicar os limites.
    trialAvailable: hasTrial(row.id),
    userRating: averageRating(row.ratingSum, row.ratingCount),
    reviewsCount: row.ratingCount,
    verifiedUses: Number(row.verifiedUses),
    evalScore: bpsToScore(row.evalScoreBps),
    requirements: row.requirements,
    packageContents: row.packageContents,
    guaranteeAvailable: guaranteeOffered(row),
    resaleFloorUsdc: extras.resaleFloor == null ? null : unitsToUsdc(extras.resaleFloor),
    royaltyBps: row.royaltyBps,
    // Teto de licenças: espelho do banco (total_sales / max_licenses), sem consulta extra.
    supply: supplyOfRow(row),
    // A1 (Criador de Solvers): platform vem da lista PLATFORM_AGENTS e differentiators do validador; até lá, valores neutros.
    platform: false,
    differentiators: [],
    trend7d: extras.trend7d,
    publishedAt: publishedAt(row),
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
    listedForResale: row.listedForResale,
    resalePriceUsdc: row.resalePrice == null ? null : unitsToUsdc(row.resalePrice),
  };
}

export function toReview(row: ReviewRow, authorName: string | null = null, images: ImageRef[] = []): Review {
  return {
    id: row.id,
    agentId: row.agentId,
    authorWallet: row.authorWallet,
    rating: row.rating,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    verifiedPurchase: true,
    authorName,
    images,
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
    title: row.title,
    agentId: row.agentId,
    buyerWallet: row.buyerWallet,
    amountUsdc: unitsToUsdc(row.total),
    status,
    milestones,
    // Sem etapa aprovada nos testes ainda, não há prazo de liberação automática: string vazia.
    autoReleaseAt: row.autoReleaseAt ? row.autoReleaseAt.toISOString() : "",
    // Nulos em tarefas criadas antes do programa v2.
    deliveryDeadline: row.deliveryDeadline ? row.deliveryDeadline.toISOString() : null,
    feeBps: row.feeBps ?? null,
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

import { z } from "zod";
import { AgentSupply } from "./supply.js";

// Contrato de dados compartilhado com o frontend (INSTRUCTIONS.md seção 3).
// Os nomes de campos destes schemas não podem mudar: o front usa os mesmos nos mocks.

export const Requirement = z.object({
  type: z.enum(["client", "connector", "plan"]),
  label: z.string(),
  key: z.string().optional(),
  /** Opcional: se faltar, o preflight avisa sem bloquear (ex.: Figma com caminho sem conector). */
  optional: z.boolean().optional(),
  /** Conector: como conectar, em 1–3 frases (o criador escreve para conectores fora do catálogo). */
  howTo: z.string().max(600).optional(),
  /** Conector: link da ajuda oficial, usado como reserva quando o menu da IA mudar. */
  helpUrl: z.string().url().optional(),
});

export const Agent = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  creatorId: z.string(),
  version: z.string(),
  versionHash: z.string(),
  priceUsdc: z.number(),
  /** Tem teste grátis (limites em AgentDetail.trial). */
  trialAvailable: z.boolean(),
  userRating: z.number(),
  reviewsCount: z.number(),
  verifiedUses: z.number(),
  evalScore: z.number(),
  requirements: z.array(Requirement),
  packageContents: z.array(z.string()),
  guaranteeAvailable: z.boolean(),
  resaleFloorUsdc: z.number().nullable(),
  /** Royalty do criador nas revendas pelo mercado, em pontos-base (`Agent.royalty_bps` on-chain). 0 em dados antigos. */
  royaltyBps: z.number().default(0),
  /** Teto de licenças (docs/licencas-limitadas.md). O padrão mantém clientes e dados antigos parseando: ilimitado. */
  supply: AgentSupply.default({ max: null, sold: 0, left: null }),
  trend7d: z.number(),
  /** Data da primeira versão publicada (ISO). */
  publishedAt: z.string(),
});

export const Creator = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string(),
  reputationScore: z.number(),
  disputesLost: z.number(),
  agentsPublished: z.number(),
});

export const License = z.object({
  id: z.string(),
  agentId: z.string(),
  ownerWallet: z.string(),
  acquiredAt: z.string(),
  /** Só existe licença vitalícia (o pagamento por uso acabou). */
  type: z.literal("permanent"),
  listedForResale: z.boolean(),
  resalePriceUsdc: z.number().nullable(),
});

/** Imagem hospedada no CDN: `url` é a versão ampliada, `thumbUrl` a miniatura. */
export const ImageRef = z.object({
  id: z.string(),
  url: z.string(),
  thumbUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});

export const Review = z.object({
  id: z.string(),
  agentId: z.string(),
  authorWallet: z.string(),
  rating: z.number().int().min(1).max(5),
  text: z.string(),
  createdAt: z.string(),
  verifiedPurchase: z.literal(true),
  /** Nome do perfil de quem avaliou (null: a vitrine mostra a carteira encurtada). */
  authorName: z.string().nullable(),
  /** Fotos que o comprador anexou (até MAX_REVIEW_IMAGES). */
  images: z.array(ImageRef).default([]),
});

export const MilestoneStatus = z.enum(["pending", "submitted", "passed", "approved", "disputed", "refunded"]);

export const Milestone = z.object({
  title: z.string(),
  criteria: z.string(),
  status: MilestoneStatus,
});

export const EscrowStatus = z.enum(["active", "approved", "disputed", "refunded"]);

export const Escrow = z.object({
  id: z.string(),
  /** Título da tarefa, escrito pelo comprador. */
  title: z.string(),
  agentId: z.string(),
  buyerWallet: z.string(),
  amountUsdc: z.number(),
  status: EscrowStatus,
  milestones: z.array(Milestone),
  autoReleaseAt: z.string(),
  /** Prazo de entrega (ISO). Nulo em tarefas criadas antes do prazo existir. */
  deliveryDeadline: z.string().nullable(),
  /** Taxa da plataforma fixada na criação (pontos-base). Nulo em tarefas antigas. */
  feeBps: z.number().nullable(),
});

export const Memory = z.object({
  id: z.string(),
  agentId: z.string(),
  summary: z.string(),
  updatedAt: z.string(),
});

export const GuaranteeLevel = z.enum(["limited", "full", "none"]);

export const UserReputation = z.object({
  wallet: z.string(),
  score: z.number(),
  purchases: z.number(),
  disputesLost: z.number(),
  guaranteeLevel: GuaranteeLevel,
});

export type Requirement = z.infer<typeof Requirement>;
export type Agent = z.infer<typeof Agent>;
export type Creator = z.infer<typeof Creator>;
export type License = z.infer<typeof License>;
export type ImageRef = z.infer<typeof ImageRef>;
export type Review = z.infer<typeof Review>;
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;
export type Milestone = z.infer<typeof Milestone>;
export type EscrowStatus = z.infer<typeof EscrowStatus>;
export type Escrow = z.infer<typeof Escrow>;
export type Memory = z.infer<typeof Memory>;
export type GuaranteeLevel = z.infer<typeof GuaranteeLevel>;
export type UserReputation = z.infer<typeof UserReputation>;

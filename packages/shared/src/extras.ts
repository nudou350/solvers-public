import { z } from "zod";
import { Agent, Creator, Escrow, GuaranteeLevel, License, Review, UserReputation } from "./schemas.js";

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

export const MilestoneVerify = z.enum(["tests", "manual"]);

/** Tarefa com garantia oferecida pelo criador: o comprador só descreve o que quer. */
export const GuaranteeOffer = z.object({
  priceUsdc: z.number(),
  priceBrl: z.number(),
  reviewWindowSecs: z.number(),
  milestones: z.array(
    z.object({
      title: z.string(),
      criteria: z.array(z.string()),
      amountUsdc: z.number(),
      /** "tests": o servidor verifica com testes; "manual": o comprador revisa a entrega (ex: um plano). */
      verify: MilestoneVerify,
    }),
  ),
});

/** Teste grátis do especialista: o que libera, com limites aplicados pelo servidor. */
export const TrialInfo = z.object({
  /** Ativações grátis por carteira. */
  uses: z.number(),
  /** Etapas iniciais liberadas (1..steps). */
  steps: z.number(),
  totalSteps: z.number(),
  /** Consultas à base (search_knowledge) no teste inteiro. */
  searches: z.number(),
  /** Execuções por ferramenta no teste inteiro; ferramenta fora da lista fica bloqueada. */
  tools: z.array(z.object({ name: z.string(), limit: z.number() })),
  /** Combinado do tamanho do pedido no teste (ex.: "1 componente por uso"). */
  scope: z.string().nullable(),
  summary: z.string(),
  lockedSummary: z.string(),
});

/** GET /api/agents/:slug */
export const AgentDetail = z.object({
  agent: Agent,
  creator: Creator,
  reviews: z.array(Review),
  beforeAfter: z.array(BeforeAfter),
  versions: z.array(AgentVersion),
  /** null: especialista sem teste grátis. */
  trial: TrialInfo.nullable(),
  priceBrl: z.number().nullable(),
  resalePriceHistory: z.array(z.object({ date: z.string(), priceUsdc: z.number() })),
  /** Quantidade de avaliações por nota, de 5 a 1 estrela. */
  ratingDistribution: z.array(z.number()).length(5),
  /** Contas on-chain do especialista (link "verificar na blockchain"). */
  onchain: z.object({ agent: z.string().nullable(), collection: z.string().nullable(), creatorWallet: z.string().nullable() }),
  /** null quando o especialista não oferece garantia (ou ainda não atingiu o mínimo de vendas e nota). */
  guarantee: GuaranteeOffer.nullable(),
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
    disputesOpen: z.number(),
    disputesLost: z.number(),
  }),
  /** Últimos 30 dias. */
  last30: z.object({ sales: z.number(), uses: z.number(), revenueUsdc: z.number() }),
  /** Parte do criador em cada venda (1 - taxa da plataforma). */
  creatorSharePct: z.number(),
  agents: z.array(
    z.object({
      agentId: z.string(),
      slug: z.string(),
      name: z.string(),
      category: z.string(),
      version: z.string(),
      status: z.enum(["active", "pending", "suspended", "retired"]),
      listed: z.boolean(),
      userRating: z.number(),
      evalScore: z.number(),
      sales: z.number(),
      uses: z.number(),
      revenueUsdc: z.number(),
      disputes: z.number(),
    }),
  ),
  daily: z.array(z.object({ date: z.string(), sales: z.number(), uses: z.number(), revenueUsdc: z.number() })),
  /** Ganhos de tarefas com garantia (etapas liberadas ao criador, já sem a taxa), à parte das vendas. */
  guarantee: z
    .object({
      earnedUsdc: z.number(),
      last30Usdc: z.number(),
      releases: z.number(),
      recent: z.array(z.object({ signature: z.string(), agentId: z.string().nullable(), amountUsdc: z.number(), at: z.string() })),
    })
    .optional(),
  disputes: z.array(
    z.object({
      escrowId: z.string(),
      index: z.number(),
      agentId: z.string(),
      taskTitle: z.string(),
      milestoneTitle: z.string(),
      criterion: z.string().nullable(),
      reason: z.string().nullable(),
      amountUsdc: z.number(),
      openedAt: z.string().nullable(),
      result: z.enum(["open", "buyer", "creator"]),
    }),
  ),
});

/** GET /api/connector */
export const ConnectorStatus = z.object({
  url: z.string(),
  authorizedClients: z.array(z.object({ clientName: z.string(), authorizedAt: z.string() })),
});

/** GET /api/me/profile */
export const Profile = z.object({
  wallet: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  memberSince: z.string(),
  reputation: UserReputation,
  creator: Creator.nullable(),
  explorerUrl: z.string(),
  history: z.array(z.object({ kind: z.string(), label: z.string(), at: z.string(), signature: z.string().nullable() })),
});

/** GET /api/me/escrows/:id */
export const EscrowDetail = z.object({
  escrow: Escrow,
  description: z.string(),
  createdAt: z.string(),
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
      verify: MilestoneVerify,
      hasAcceptanceTests: z.boolean(),
      disputeCriterion: z.string().nullable(),
      downloadable: z.boolean(),
      /** Quando o comprador contestou (ISO), ou nulo. */
      disputedAt: z.string().nullable(),
      /** Só para etapa que nunca foi entregue: data a partir da qual, sem julgamento, o comprador é reembolsado automaticamente (ISO). Nulo se não houve contestação ou se a etapa já passou nos testes (aí só um administrador julga). */
      disputeDeadline: z.string().nullable(),
      /** Etapa pendente com prazo de entrega vencido: o comprador pode cancelar e receber de volta. */
      canCancelUndelivered: z.boolean(),
    }),
  ),
  explorerUrl: z.string(),
});

/** GET /api/me/guarantee: quanto a carteira ainda pode colocar em garantias abertas. */
export const GuaranteeStatus = z.object({
  level: GuaranteeLevel,
  limitUsdc: z.number(),
  openUsdc: z.number(),
  availableUsdc: z.number(),
  purchases: z.number(),
  /** Compras que faltam para o nível completo (0 quando já está nele). */
  purchasesToFull: z.number(),
  disputesLost: z.number(),
  maxDisputesLost: z.number(),
  /** Acima deste valor, contas no nível limitado precisam de pelo menos 2 etapas. */
  singleMilestoneMaxUsdc: z.number(),
});

/** GET /api/me/usage */
export const UsageSummary = z.object({
  agentId: z.string(),
  activations: z.number(),
  calls: z.number(),
  lastUsedAt: z.string().nullable(),
  usesThisMonth: z.number(),
  /** Ativações por semana, das 8 últimas (a última é a semana atual). */
  weekly: z.array(z.number()).length(8),
});

/** GET /api/me/access/:idOrSlug: como a carteira acessa o especialista agora. */
export const AgentAccess = z.object({
  agentId: z.string(),
  /** Id da licença (asset) ou null. */
  license: z.string().nullable(),
  /** 0 quando o especialista não tem teste grátis. */
  trialUsesLeft: z.number(),
  /** Saldo do teste inteiro (null: sem teste grátis). */
  trial: z.object({ searchesLeft: z.number(), toolsLeft: z.record(z.number()) }).nullable(),
});

/**
 * GET /api/me/trials: testes grátis em andamento da carteira (um por especialista já ativado,
 * sem licença). `usesLeft` 0 = teste esgotado.
 */
export const MyTrial = z.object({
  agentId: z.string(),
  uses: z.number(),
  usesLeft: z.number(),
  searches: z.number(),
  searchesLeft: z.number(),
  tools: z.array(z.object({ name: z.string(), limit: z.number(), left: z.number() })),
  lastUsedAt: z.string(),
});

/** GET /api/config */
/** Pix na demo: o comprador paga em reais e recebe USDC de teste (sem dinheiro real na devnet). */
export const PixConfig = z.object({
  /** false na mainnet (lá o Pix virá de um on-ramp licenciado) ou sem provedor configurado. */
  enabled: z.boolean(),
  /** Mostra o botão "simular pagamento" (só fora da mainnet). */
  simulate: z.boolean(),
  provider: z.enum(["mercadopago", "simulated"]).nullable(),
  minBrl: z.number(),
  maxBrl: z.number(),
});

/**
 * SODAX na demo: o comprador escolhe pagar com cripto de outra rede (Ethereum, Base, Arbitrum...). A cotação é
 * real (API pública do SODAX); o pagamento é simulado e credita USDC de teste. A execução real do swap exige
 * mainnet (o SODAX não tem testnet) e fica para a próxima fase.
 */
export const SodaxSource = z.object({
  key: z.string(),
  /** Texto curto para a opção, ex.: "ETH na Base". */
  label: z.string(),
  network: z.string(),
  symbol: z.string(),
});

export const SodaxConfig = z.object({
  /** false na mainnet (execução real ainda não existe) ou com SODAX_SIMULATE desligado. */
  enabled: z.boolean(),
  /** Mostra o botão de pagamento de teste (só fora da mainnet). */
  simulate: z.boolean(),
  sources: z.array(SodaxSource),
});

/** GET /api/sodax/quote: quanto o comprador pagaria na outra rede para receber o USDC que falta. */
export const SodaxQuote = z.object({
  source: SodaxSource,
  /** Valor a pagar na origem, já com folga para a taxa (decimal, ex.: 0.00741). */
  payAmount: z.number(),
  /** USDC que chegariam na carteira (>= o necessário; maior quando o valor mínimo do SODAX foi aplicado). */
  receiveUsdc: z.number(),
  /** USDC que faltam para a compra (descontado o saldo). */
  needUsdc: z.number(),
  /** true quando o valor era menor que o mínimo do SODAX (~US$ 1) e a cotação usa o mínimo. */
  minApplied: z.boolean(),
  /** Quando o SODAX respondeu (ISO). A cotação vale por poucos segundos. */
  quotedAt: z.string(),
});

export const PixChargeStatus = z.enum(["pending", "approved", "credited", "expired", "failed"]);

/** POST /api/pix/charges e GET /api/pix/charges/:id (também usado pelas cobranças SODAX da demo) */
export const PixCharge = z.object({
  id: z.string(),
  provider: z.enum(["mercadopago", "simulated", "sodax"]),
  /** pending: aguardando o Pix; approved: pago, creditando; credited: USDC na carteira. */
  status: PixChargeStatus,
  amountBrl: z.number(),
  amountUsdc: z.number(),
  /** Pix copia e cola. No modo simulado é um texto fictício que não pode ser pago. */
  qrCode: z.string().nullable(),
  /** PNG em base64 (sem o prefixo data:). null no modo simulado. */
  qrCodeBase64: z.string().nullable(),
  ticketUrl: z.string().nullable(),
  expiresAt: z.string(),
  creditSignature: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  purpose: z.object({ agentId: z.string(), type: z.enum(["permanent", "guarantee"]) }).nullable(),
  simulated: z.boolean(),
  createdAt: z.string(),
});

export const PublicConfig = z.object({
  cluster: z.string(),
  rpcUrl: z.string().nullable(),
  programId: z.string(),
  usdcMint: z.string(),
  feePayer: z.string(),
  feeBps: z.number().nullable(),
  minPurchaseUsdc: z.number(),
  faucetEnabled: z.boolean(),
  faucetAmountUsdc: z.number(),
  brlPerUsd: z.number(),
  connectorUrl: z.string(),
  freeTrialUses: z.number(),
  reviewWindowSecs: z.number(),
  guaranteeLimitsUsdc: z.object({ none: z.number(), limited: z.number(), full: z.number() }),
  guaranteeMinSales: z.number(),
  guaranteeMinRating: z.number(),
  pix: PixConfig,
  /** Ausente em servidores antigos: o front só mostra a opção SODAX quando vem enabled. */
  sodax: SodaxConfig.optional(),
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
export type TrialInfo = z.infer<typeof TrialInfo>;
export type AgentAccess = z.infer<typeof AgentAccess>;
export type MyTrial = z.infer<typeof MyTrial>;
export type CreatorProfile = z.infer<typeof CreatorProfile>;
export type CreatorDashboard = z.infer<typeof CreatorDashboard>;
export type ConnectorStatus = z.infer<typeof ConnectorStatus>;
export type Profile = z.infer<typeof Profile>;
export type TxResponse = z.infer<typeof TxResponse>;
export type EscrowDetail = z.infer<typeof EscrowDetail>;
export type GuaranteeOffer = z.infer<typeof GuaranteeOffer>;
export type MilestoneVerify = z.infer<typeof MilestoneVerify>;
export type GuaranteeStatus = z.infer<typeof GuaranteeStatus>;
export type UsageSummary = z.infer<typeof UsageSummary>;
export type PublicConfig = z.infer<typeof PublicConfig>;
export type PixConfig = z.infer<typeof PixConfig>;
export type PixCharge = z.infer<typeof PixCharge>;
export type PixChargeStatus = z.infer<typeof PixChargeStatus>;
export type SodaxSource = z.infer<typeof SodaxSource>;
export type SodaxConfig = z.infer<typeof SodaxConfig>;
export type SodaxQuote = z.infer<typeof SodaxQuote>;
export type ResaleListing = z.infer<typeof ResaleListing>;
export type SubmitResponse = z.infer<typeof SubmitResponse>;

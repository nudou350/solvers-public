import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { AgentVersion, BeforeAfter, Requirement } from "@solvers/shared";

// Espelho do estado on-chain + dados off-chain (INSTRUCTIONS.md 5.12).
// Valores de USDC em unidades de 6 casas (bigint), convertidos para número só na API.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const u64 = (name: string) => bigint(name, { mode: "bigint" });

export const creators = pgTable("creators", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  bio: text("bio").notNull().default(""),
  telegramChatId: text("telegram_chat_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type AgentDetails = {
  beforeAfter?: BeforeAfter[];
  versions?: AgentVersion[];
  tools?: { name: string; description: string; runner: string }[];
  guaranteeCriteria?: string[];
  /** Modelo de tarefa com garantia definido pelo criador (manifest.guarantee). */
  guaranteeTemplate?: { priceUsdc: number; milestones: { title: string; criteria: string[]; sharePct: number; verify: "tests" | "manual" }[] };
  catalogOnly?: boolean;
};

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(), // agent_id hex (16 bytes)
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    tagline: text("tagline").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    creatorId: text("creator_id").notNull(),
    version: text("version").notNull(),
    versionHash: text("version_hash").notNull(),
    price: u64("price").notNull(),
    pricePerUse: u64("price_per_use").notNull().default(sql`0`),
    royaltyBps: integer("royalty_bps").notNull().default(0),
    evalScoreBps: integer("eval_score_bps").notNull().default(0),
    evalHash: text("eval_hash"),
    status: text("status").notNull().default("pending"), // pending | active | suspended
    totalSales: u64("total_sales").notNull().default(sql`0`),
    verifiedUses: u64("verified_uses").notNull().default(sql`0`),
    ratingSum: u64("rating_sum").notNull().default(sql`0`),
    ratingCount: integer("rating_count").notNull().default(0),
    disputesLost: integer("disputes_lost").notNull().default(0),
    stake: u64("stake").notNull().default(sql`0`),
    requirements: jsonb("requirements").$type<Requirement[]>().notNull().default([]),
    packageContents: jsonb("package_contents").$type<string[]>().notNull().default([]),
    guaranteeAvailable: boolean("guarantee_available").notNull().default(false),
    /** Só aparece na loja depois que o catálogo (publish-agent) preencheu os dados. */
    listed: boolean("listed").notNull().default(false),
    details: jsonb("details").$type<AgentDetails>().notNull().default({}),
    onchainAddress: text("onchain_address"),
    collectionAddress: text("collection_address"),
    searchText: text("search_text").notNull().default(""),
    embedding: vector("embedding", { dimensions: 384 }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("agents_onchain_idx").on(t.onchainAddress),
    index("agents_fts_idx").using("gin", sql`to_tsvector('portuguese', ${t.searchText})`),
  ],
);

export const licenses = pgTable(
  "licenses",
  {
    id: text("id").primaryKey(), // endereço do asset Metaplex Core
    agentId: text("agent_id").notNull(),
    ownerWallet: text("owner_wallet").notNull(),
    acquiredAt: ts("acquired_at").notNull().defaultNow(),
    type: text("type").notNull().default("permanent"),
    listedForResale: boolean("listed_for_resale").notNull().default(false),
    resalePrice: u64("resale_price"),
    signature: text("signature"),
  },
  (t) => [index("licenses_owner_idx").on(t.ownerWallet), index("licenses_agent_idx").on(t.agentId)],
);

export const credits = pgTable(
  "credits",
  {
    agentId: text("agent_id").notNull(),
    ownerWallet: text("owner_wallet").notNull(),
    remaining: integer("remaining").notNull().default(0),
    purchased: integer("purchased").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.ownerWallet] })],
);

/** Teste grátis (off-chain) por carteira e solver: usos, consultas e execuções de ferramenta (manifest.trial). */
export const trials = pgTable(
  "trials",
  {
    agentId: text("agent_id").notNull(),
    wallet: text("wallet").notNull(),
    used: integer("used").notNull().default(0),
    /** search_knowledge no teste inteiro. */
    searchesUsed: integer("searches_used").notNull().default(0),
    /** run_tool por ferramenta no teste inteiro: { nome: execuções }. */
    toolRuns: jsonb("tool_runs").$type<Record<string, number>>().notNull().default({}),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.wallet] })],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(), // endereço da PDA de review
    agentId: text("agent_id").notNull(),
    authorWallet: text("author_wallet").notNull(),
    rating: smallint("rating").notNull(),
    text: text("text").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    onchain: boolean("onchain").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reviews_agent_author_idx").on(t.agentId, t.authorWallet)],
);

/**
 * Rascunhos de avaliação: o texto e a nota preparados em /tx/review, por hash do conteúdo. Só viram
 * `reviews.text` quando o indexador vê o mesmo hash confirmado on-chain (syncReview).
 */
export const reviewDrafts = pgTable(
  "review_drafts",
  {
    agentId: text("agent_id").notNull(),
    authorWallet: text("author_wallet").notNull(),
    contentHash: text("content_hash").notNull(),
    rating: smallint("rating").notNull(),
    text: text("text").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.authorWallet, t.contentHash] })],
);

export const escrows = pgTable(
  "escrows",
  {
    id: text("id").primaryKey(), // endereço da PDA
    agentId: text("agent_id").notNull(),
    buyerWallet: text("buyer_wallet").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    nonce: u64("nonce").notNull(),
    total: u64("total").notNull(),
    status: text("status").notNull().default("pending"), // pending (tx não confirmada) | active | approved | disputed | refunded
    autoReleaseAt: ts("auto_release_at"),
    reviewWindowSecs: integer("review_window_secs").notNull(),
    /** Prazo de entrega fixado na criação (nulo em tarefas anteriores ao programa v2). */
    deliveryDeadline: ts("delivery_deadline"),
    /** Taxa da plataforma fixada na criação, em pontos-base (nulo em tarefas anteriores ao programa v2). */
    feeBps: integer("fee_bps"),
    closed: boolean("closed").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("escrows_buyer_idx").on(t.buyerWallet)],
);

export const milestones = pgTable(
  "milestones",
  {
    escrowId: text("escrow_id").notNull(),
    idx: integer("idx").notNull(),
    title: text("title").notNull(),
    criteria: text("criteria").notNull(),
    criteriaHash: text("criteria_hash").notNull(),
    /** tests: verificador automático; manual: o comprador revisa a entrega (ex: plano). */
    verify: text("verify").notNull().default("tests"),
    amount: u64("amount").notNull(),
    status: text("status").notNull().default("pending"),
    passedAt: ts("passed_at"),
    deliverablePath: text("deliverable_path"),
    deliverableHash: text("deliverable_hash"),
    previewUrl: text("preview_url"),
    /** Bateria de aceite combinada na criação (a entrega não consegue trocá-la). */
    acceptancePath: text("acceptance_path"),
    acceptanceHash: text("acceptance_hash"),
    verifierReport: jsonb("verifier_report").$type<Record<string, unknown>>(),
    disputeReason: text("dispute_reason"),
    disputeCriterion: text("dispute_criterion"),
    disputedAt: ts("disputed_at"),
  },
  (t) => [primaryKey({ columns: [t.escrowId, t.idx] })],
);

/** Dados de perfil fora da blockchain (nome e e-mail vêm do login por e-mail). */
export const userProfiles = pgTable("user_profiles", {
  wallet: text("wallet").primaryKey(),
  displayName: text("display_name"),
  email: text("email"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const userReputation = pgTable("user_reputation", {
  wallet: text("wallet").primaryKey(),
  purchases: integer("purchases").notNull().default(0),
  disputesOpened: integer("disputes_opened").notNull().default(0),
  disputesLost: integer("disputes_lost").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    agentId: text("agent_id"),
    sessionId: text("session_id"),
    tool: text("tool").notNull(),
    responseHash: text("response_hash"),
    batched: boolean("batched").notNull().default(false),
    /** Lote em envio (marcado antes da transação para não contar duas vezes). */
    batchId: text("batch_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("usage_agent_created_idx").on(t.agentId, t.createdAt), index("usage_wallet_idx").on(t.wallet)],
);

/**
 * Lotes de uso enviados on-chain (record_usage_batch). A transação é assinada e gravada ANTES do envio:
 * a assinatura permite reconciliar (confirmada, falhou ou expirou) sem contar o mesmo uso duas vezes.
 * `usage_events.batch_id` aponta para `id`.
 */
export const usageBatches = pgTable(
  "usage_batches",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    count: integer("count").notNull(),
    merkleRoot: text("merkle_root").notNull(),
    signature: text("signature").notNull(),
    wire: text("wire").notNull(),
    lastValidHeight: u64("last_valid_height").notNull(),
    status: text("status").notNull().default("pending"), // pending | confirmed | released
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("usage_batches_status_idx").on(t.status)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  agentId: text("agent_id").notNull(),
  version: text("version").notNull(),
  stepIndex: integer("step_index").notNull().default(0),
  access: text("access").notNull(), // license | guarantee (context.escrowId) | trial (credits: sessões antigas)
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  licenseId: text("license_id"),
  calls: integer("calls").notNull().default(0),
  expiresAt: ts("expires_at").notNull().default(sql`now() + interval '24 hours'`),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  purpose: text("purpose").notNull().default("login"),
  expiresAt: ts("expires_at").notNull(),
});

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const oauthCodes = pgTable("oauth_codes", {
  code: text("code").primaryKey(),
  clientId: text("client_id").notNull(),
  wallet: text("wallet").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scope: text("scope"),
  resource: text("resource"),
  memoryKey: bytea("memory_key"), // chave de memória já cifrada com a KEK
  expiresAt: ts("expires_at").notNull(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    wallet: text("wallet").notNull(),
    refreshHash: text("refresh_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("oauth_tokens_wallet_idx").on(t.wallet)],
);

/** Chave de memória por sessão de token (cifrada com SERVER_KEK). Some ao expirar. */
export const memoryKeys = pgTable("memory_keys", {
  tokenId: text("token_id").primaryKey(),
  wallet: text("wallet").notNull(),
  wrappedKey: bytea("wrapped_key").notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    agentId: text("agent_id").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    tag: bytea("tag").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memories_wallet_agent_idx").on(t.wallet, t.agentId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    version: text("version").notNull(),
    source: text("source").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 384 }),
  },
  (t) => [
    index("knowledge_agent_idx").on(t.agentId, t.version),
    index("knowledge_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("knowledge_fts_idx").using("gin", sql`to_tsvector('portuguese', ${t.content})`),
  ],
);

/** Vetores extras da busca na vitrine (tagline e searchPhrases): o solver vale pelo que casar melhor. */
export const agentSearchVectors = pgTable(
  "agent_search_vectors",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
  },
  (t) => [index("agent_search_vectors_agent_idx").on(t.agentId)],
);

export const processedEvents = pgTable(
  "processed_events",
  {
    signature: text("signature").notNull(),
    idx: integer("idx").notNull(),
    name: text("name").notNull(),
    processedAt: ts("processed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.signature, t.idx] })],
);

/** Transações que falharam no indexador: tentadas de novo sem travar o cursor. */
export const indexerFailures = pgTable("indexer_failures", {
  signature: text("signature").primaryKey(),
  /** Só falhas que não são de infraestrutura contam (RPC fora do ar não gasta tentativas). */
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error").notNull(),
  /** Backoff: a próxima tentativa só roda depois deste horário. */
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  /** pending (será tentada de novo) | dead (desistiu: precisa de reprocesso manual, ver cli:reindex). */
  status: text("status").notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Registro de cada transação do programa vista pelo indexador (histórico e "verificar na blockchain"). */
export const chainTxs = pgTable(
  "chain_txs",
  {
    signature: text("signature").primaryKey(),
    wallet: text("wallet"),
    kind: text("kind").notNull(),
    agentId: text("agent_id"),
    /** Valor bruto movimentado (compra, pacote, depósito do escrow ou etapa liberada). */
    amount: u64("amount"),
    /** Horário do bloco (created_at é o momento da indexação, que pode atrasar ou repetir). */
    blockTime: ts("block_time"),
    /** Valores efetivamente executados, lidos dos saldos de token da transação. */
    fee: u64("fee"),
    creatorAmount: u64("creator_amount"),
    creatorWallet: text("creator_wallet"),
    /** Taxa da plataforma no momento da transação (bps). */
    feeBps: integer("fee_bps"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("chain_txs_wallet_idx").on(t.wallet), index("chain_txs_agent_idx").on(t.agentId)],
);

export const escalations = pgTable("escalations", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  agentId: text("agent_id").notNull(),
  sessionId: text("session_id"),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("open"),
  notified: boolean("notified").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const resalePrices = pgTable("resale_prices", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  price: u64("price").notNull(),
  at: ts("at").notNull().defaultNow(),
});


/** Cobranças Pix da demo: o comprador paga em reais e recebe USDC de teste (sem conversão real). */
export const pixCharges = pgTable(
  "pix_charges",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    provider: text("provider").notNull(), // mercadopago | simulated
    providerOrderId: text("provider_order_id"),
    externalReference: text("external_reference").notNull().unique(),
    amountBrl: integer("amount_brl").notNull(), // centavos
    amountUsdc: u64("amount_usdc").notNull(), // unidades de 6 casas
    status: text("status").notNull().default("pending"), // pending | approved | crediting | credited | expired | failed
    qrCode: text("qr_code"),
    qrBase64: text("qr_base64"),
    ticketUrl: text("ticket_url"),
    expiresAt: ts("expires_at").notNull(),
    creditSignature: text("credit_signature"),
    /** Transação do crédito já assinada, gravada antes do envio (reenviar a mesma nunca emite duas vezes). */
    creditWire: text("credit_wire"),
    creditLastValidHeight: u64("credit_last_valid_height"),
    // Cobranças antigas podem ter type "credits" (pagamento por uso acabou): a API as mostra sem purpose.
    purpose: jsonb("purpose").$type<{ agentId: string; type: "permanent" | "guarantee" }>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("pix_charges_wallet_idx").on(t.wallet, t.status), uniqueIndex("pix_charges_order_idx").on(t.providerOrderId)],
);

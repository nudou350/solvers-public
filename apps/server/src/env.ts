import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

/** Booleano sem padrão fixo: undefined quando a variável não foi definida (o padrão depende da rede). */
const optBool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true" || v === "1"));

/** Variável vazia no .env (`X=`) conta como ausente. */
const blankToUndefined = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const base = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3017),
  /** URL pública da API (mesmo domínio da vitrine, rotas /api /mcp /oauth). */
  PUBLIC_API_URL: z.string().url().default("http://localhost:3017"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  /** Domínio usado na mensagem SIWS (host da vitrine). */
  SIWS_DOMAIN: z.string().optional(),

  DATABASE_URL: z.string().default("postgres://solvers:solvers@127.0.0.1:5433/solvers"),

  SOLANA_RPC_URL: z.string().default("http://127.0.0.1:8899"),
  SOLANA_CLUSTER: z.enum(["devnet", "mainnet-beta", "localnet"]).default("localnet"),
  USDC_MINT: z.string().min(32),
  /** Fee payer da plataforma (paga taxas e rent). JSON, base58 ou caminho de arquivo. */
  FEE_PAYER_KEYPAIR: z.string().min(1),
  VERIFIER_KEYPAIR: z.string().min(1),
  USAGE_AUTHORITY_KEYPAIR: z.string().min(1),
  /** Só em desenvolvimento/demo: permite aprovar solvers e resolver disputas pelo servidor. Recusada com SOLANA_CLUSTER=mainnet-beta (MAINNET_FORBIDDEN_KEYS). */
  ADMIN_KEYPAIR: z.string().optional(),
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.bigint().default(0n),

  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  INDEXER_POLL_MS: z.coerce.number().default(10_000),
  INDEXER_ENABLED: bool.default("true"),

  JWT_SECRET: z.string().min(32),
  /** 32 bytes em base64: cifra as chaves de memória. */
  SERVER_KEK: z.string().min(40),

  /** Revenda de licenças (mercado entre usuários). Desligada por padrão: o deploy sobe com ela off e só se liga depois do upgrade do programa. */
  RESALE_ENABLED: bool.default("false"),
  FAUCET_ENABLED: bool.default("false"),
  FAUCET_AMOUNT_USDC: z.coerce.number().default(50),
  /** Cotação de fallback USD->BRL quando a API de câmbio falhar. */
  BRL_PER_USD: z.coerce.number().default(5.4),

  /** CDN das imagens (galeria do criador e fotos de avaliação). Sem as 3, as rotas de imagem respondem 503. */
  CLOUDINARY_CLOUD_NAME: blankToUndefined,
  CLOUDINARY_API_KEY: blankToUndefined,
  CLOUDINARY_API_SECRET: blankToUndefined,

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Chat que recebe alertas quando o criador não tem Telegram configurado. */
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),

  EMBEDDING_MODEL: z.string().default("Xenova/multilingual-e5-small"),
  /** "local" usa transformers.js; "fts" usa só busca full text do Postgres (plano B). */
  SEARCH_MODE: z.enum(["local", "fts"]).default("local"),

  AGENTS_DIR: z.string().default("../../agents"),
  /** ZIPs enviados e pastas extraídas (fora do release; sobrevive ao deploy). PACKAGE_SPEC.md 15.1. */
  SUBMISSIONS_DIR: z.string().default("./data/submissions"),
  /** Pacotes de criadores publicados (um ativo por slug, versões antigas em _archive/). Mesclados com AGENTS_DIR no carregador. */
  PUBLISHED_DIR: z.string().default("./data/packages"),
  /** Carteiras (separadas por vírgula) que revisam submissões no site. Aprovar no site não assina nada on-chain. */
  ADMIN_WALLETS: z.string().default(""),
  /** Tetos do envio de pacote no Núcleo (PACKAGE_SPEC.md 3.2). */
  SUBMISSION_MAX_ZIP_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  SUBMISSION_MAX_UNZIPPED_BYTES: z.coerce.number().int().positive().default(150 * 1024 * 1024),
  SUBMISSION_MAX_FILES: z.coerce.number().int().positive().default(2000),
  /** Limites por criador: pendentes ao mesmo tempo e envios por dia. */
  SUBMISSION_MAX_PENDING: z.coerce.number().int().min(1).default(3),
  SUBMISSION_MAX_PER_DAY: z.coerce.number().int().min(1).default(5),
  /** Processa o ZIP dentro do próprio servidor, logo após o upload (QA local sem o worker do PM2). Em produção fica desligado. */
  SUBMISSIONS_INLINE: bool.default("false"),
  /** Cota diária de search_knowledge por licença (PACKAGE_SPEC.md 6.5, item 2). 0 desliga. */
  SEARCH_DAILY_QUOTA: z.coerce.number().int().min(0).default(300),
  DELIVERABLES_DIR: z.string().default("./deliverables"),
  /** Imagem Docker do verificador (vazio desativa o sandbox e usa execução simulada). */
  VERIFIER_IMAGE: z.string().default("solvers-react-test"),
  VERIFIER_MODE: z.enum(["docker", "simulated"]).default("docker"),
  /** Janela para o comprador revisar uma etapa aprovada nos testes. */
  ESCROW_REVIEW_WINDOW_SECS: z.coerce.number().default(72 * 3600),
  AUTO_RELEASE_ENABLED: bool.default("true"),
  /** O criador só oferece garantia depois deste número de vendas... */
  GUARANTEE_MIN_SALES: z.coerce.number().int().min(0).default(10),
  /** ...e com nota média igual ou acima desta (0 desliga a exigência de nota). */
  GUARANTEE_MIN_RATING: z.coerce.number().min(0).max(5).default(4),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),

  /** Pix na demo (Mercado Pago, API Orders). Sem token, só o modo simulado funciona. */
  MP_ACCESS_TOKEN: z.string().min(10).optional(),
  /** Secret da assinatura dos webhooks (painel do Mercado Pago > Webhooks). */
  MP_WEBHOOK_SECRET: z.string().min(8).optional(),
  /** Credenciais de teste: o pagador vai como "APRO" (aprovação automática). Padrão: true fora da mainnet. */
  MP_TEST_MODE: optBool,
  /** Permite simular a aprovação do Pix sem o Mercado Pago. Padrão: true fora da mainnet; nunca na mainnet. */
  PIX_SIMULATE: optBool,
  /** Opção de pagamento SODAX na demo (cotação real + pagamento de teste). Padrão: true fora da mainnet; nunca na mainnet. */
  SODAX_SIMULATE: optBool,
  /** API pública de swaps do SODAX (sem chave). Sobrescreva só para testes. */
  SODAX_API_URL: z.string().url().default("https://api.sodax.com/v1/swaps"),

  /** Agentes de IA comprando licenças por x402 (docs/x402-agentes.md). Desligado por padrão; recusado na mainnet (custódia sem parecer jurídico). */
  X402_ENABLED: bool.default("false"),
  /** Facilitator que confere e liquida o pagamento (a spike 0.2 mostrou que o público aceita o nosso USDC da devnet). */
  X402_FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  /** Rede do `accepts` (CAIP-2). Padrão: devnet. */
  X402_NETWORK: z.string().min(3).default("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
  /** Carteira de custódia: recebe o USDC do agente, compra a licença e a repassa. JSON, base58 ou caminho de arquivo. Obrigatória com X402_ENABLED. */
  CUSTODY_KEYPAIR: blankToUndefined,
  /** Piso da rota em USDC. Nunca abaixo do `min_price` do programa (a rota usa o maior dos dois). */
  X402_MIN_PRICE_USDC: z.coerce.number().positive().default(5),
  /** Teto por compra em USDC (limita a exposição da custódia). */
  X402_MAX_PRICE_USDC: z.coerce.number().positive().default(100),
  X402_ORDER_TTL_SECS: z.coerce.number().int().min(60).default(900),
  /** Ordens abertas (sem pagamento) por IP; a rota sem pagamento escreve no banco. */
  X402_MAX_OPEN_ORDERS_PER_IP: z.coerce.number().int().min(1).default(20),
  /** SÓ para o e2e (scripts/src/e2e-agent.ts): faz toda emissão falhar logo depois do pagamento, para provar o reembolso automático. Nunca ligar de verdade. */
  X402_TEST_FAIL_MINT: bool.default("false"),
});

const schema = base.transform((e) => {
  const mainnet = e.SOLANA_CLUSTER === "mainnet-beta";
  return {
    ...e,
    MP_TEST_MODE: e.MP_TEST_MODE ?? !mainnet,
    PIX_SIMULATE: !mainnet && (e.PIX_SIMULATE ?? true),
    SODAX_SIMULATE: !mainnet && (e.SODAX_SIMULATE ?? true),
  };
});

export type Env = z.infer<typeof schema>;

/**
 * Chaves que dão poder sobre o programa e que o servidor NUNCA pode carregar na mainnet-beta (docs/design-governance-v2.md §5,
 * docs/mainnet-runbook.md): admin on-chain, guardian da pausa e upgrade authority. Só ADMIN_KEYPAIR existe no schema hoje; os
 * outros nomes ficam na lista para que ninguém os acrescente por engano ao .env da produção (o zod ignoraria a variável).
 */
export const MAINNET_FORBIDDEN_KEYS = ["ADMIN_KEYPAIR", "GUARDIAN_KEYPAIR", "UPGRADE_AUTHORITY_KEYPAIR"] as const;

/** Variáveis proibidas definidas (não vazias) em `source`. Vazio ou só espaços conta como ausente (.env com `ADMIN_KEYPAIR=`). */
export function forbiddenMainnetKeys(source: NodeJS.ProcessEnv): string[] {
  return MAINNET_FORBIDDEN_KEYS.filter((k) => (source[k] ?? "").trim() !== "");
}

/**
 * Regras do x402 que dependem de mais de uma variável (puras, testáveis). Devolve a mensagem de recusa ou `null`.
 * Custódia na mainnet fica bloqueada até o parecer jurídico (docs/x402-agentes.md, seção 9).
 */
export function x402ConfigProblem(e: Pick<Env, "X402_ENABLED" | "SOLANA_CLUSTER" | "CUSTODY_KEYPAIR" | "X402_MIN_PRICE_USDC" | "X402_MAX_PRICE_USDC">, others: Record<string, string | undefined>): string | null {
  if (!e.X402_ENABLED) return null;
  if (e.SOLANA_CLUSTER === "mainnet-beta") {
    return "X402_ENABLED não pode ser ligado com SOLANA_CLUSTER=mainnet-beta: a custódia de USDC de terceiros espera o parecer jurídico (docs/x402-agentes.md, seção 9).";
  }
  if (!e.CUSTODY_KEYPAIR) return "X402_ENABLED exige CUSTODY_KEYPAIR (rode cli:x402-setup).";
  if (e.X402_MIN_PRICE_USDC > e.X402_MAX_PRICE_USDC) return "X402_MIN_PRICE_USDC não pode ser maior que X402_MAX_PRICE_USDC.";
  const same = Object.entries(others).find(([, v]) => v && v.trim() === e.CUSTODY_KEYPAIR);
  if (same) return `CUSTODY_KEYPAIR não pode ser a mesma chave de ${same[0]}: a custódia é uma carteira só dela.`;
  return null;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  const x402Problem = x402ConfigProblem(parsed.data, {
    FEE_PAYER_KEYPAIR: parsed.data.FEE_PAYER_KEYPAIR,
    VERIFIER_KEYPAIR: parsed.data.VERIFIER_KEYPAIR,
    USAGE_AUTHORITY_KEYPAIR: parsed.data.USAGE_AUTHORITY_KEYPAIR,
    ADMIN_KEYPAIR: parsed.data.ADMIN_KEYPAIR,
  });
  if (x402Problem) throw new Error(`Configuração recusada: ${x402Problem}`);
  if (parsed.data.SOLANA_CLUSTER === "mainnet-beta") {
    const found = forbiddenMainnetKeys(source);
    if (found.length > 0) {
      throw new Error(
        `Configuração recusada: ${found.join(", ")} não pode existir com SOLANA_CLUSTER=mainnet-beta. ` +
          "Na mainnet o servidor nunca assina como admin, guardian ou upgrade authority: remova a variável do .env. " +
          "Essas chaves ficam em carteira fria / Squads e são usadas só de fora (cli:admin --keypair, Squads). Veja docs/mainnet-runbook.md.",
      );
    }
  }
  return parsed.data;
}

export const env = loadEnv();

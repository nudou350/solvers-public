import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
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
  /** Só em desenvolvimento/demo: permite aprovar solvers e resolver disputas pelo servidor. */
  ADMIN_KEYPAIR: z.string().optional(),
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.bigint().default(0n),

  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  INDEXER_POLL_MS: z.coerce.number().default(10_000),
  INDEXER_ENABLED: bool.default("true"),

  JWT_SECRET: z.string().min(32),
  /** 32 bytes em base64: cifra as chaves de memória. */
  SERVER_KEK: z.string().min(40),

  FAUCET_ENABLED: bool.default("false"),
  FAUCET_AMOUNT_USDC: z.coerce.number().default(50),
  /** Cotação de fallback USD->BRL quando a API de câmbio falhar. */
  BRL_PER_USD: z.coerce.number().default(5.4),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Chat que recebe alertas quando o criador não tem Telegram configurado. */
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),

  EMBEDDING_MODEL: z.string().default("Xenova/multilingual-e5-small"),
  /** "local" usa transformers.js; "fts" usa só busca full text do Postgres (plano B). */
  SEARCH_MODE: z.enum(["local", "fts"]).default("local"),

  AGENTS_DIR: z.string().default("../../agents"),
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
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

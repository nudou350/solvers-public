// Importe ESTE arquivo primeiro nos testes que carregam módulos que leem env.ts na importação (sem .env, como no CI).
// Valores de mentira bastam: nada aqui conecta no banco nem na cadeia.
Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://x:x@127.0.0.1:1/x",
  USDC_MINT: process.env.USDC_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  FEE_PAYER_KEYPAIR: process.env.FEE_PAYER_KEYPAIR ?? "x",
  VERIFIER_KEYPAIR: process.env.VERIFIER_KEYPAIR ?? "x",
  USAGE_AUTHORITY_KEYPAIR: process.env.USAGE_AUTHORITY_KEYPAIR ?? "x",
  JWT_SECRET: process.env.JWT_SECRET ?? "j".repeat(40),
  SERVER_KEK: process.env.SERVER_KEK ?? Buffer.alloc(32, 7).toString("base64"),
});

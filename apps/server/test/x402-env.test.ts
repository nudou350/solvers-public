import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Configuração do x402: desligado por padrão, recusado na mainnet, custódia nunca repete outra chave. Puro: sem rede nem banco.

const BASE: NodeJS.ProcessEnv = {
  USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  FEE_PAYER_KEYPAIR: "fee-payer.json",
  VERIFIER_KEYPAIR: "verifier.json",
  USAGE_AUTHORITY_KEYPAIR: "usage.json",
  JWT_SECRET: "j".repeat(32),
  SERVER_KEK: "k".repeat(44),
};

for (const [k, v] of Object.entries(BASE)) process.env[k] ??= v;
const { loadEnv } = await import("../src/env.js");

describe("env: x402", () => {
  it("vem desligado, com os limites padrão (5 a 100 USDC) e o facilitator público", () => {
    const e = loadEnv({ ...BASE });
    assert.equal(e.X402_ENABLED, false);
    assert.equal(e.X402_MIN_PRICE_USDC, 5);
    assert.equal(e.X402_MAX_PRICE_USDC, 100);
    assert.equal(e.X402_ORDER_TTL_SECS, 900);
    assert.equal(e.X402_FACILITATOR_URL, "https://x402.org/facilitator");
    assert.equal(e.X402_NETWORK, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("desligado, nem a mainnet nem a falta de custódia atrapalham", () => {
    assert.doesNotThrow(() => loadEnv({ ...BASE, SOLANA_CLUSTER: "mainnet-beta" }));
  });

  it("ligado exige a custódia", () => {
    assert.throws(() => loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", X402_ENABLED: "true" }), /CUSTODY_KEYPAIR/);
    assert.throws(() => loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", X402_ENABLED: "true", CUSTODY_KEYPAIR: "  " }), /CUSTODY_KEYPAIR/);
  });

  it("ligado na mainnet-beta é recusado e a mensagem aponta o bloqueio jurídico", () => {
    assert.throws(
      () => loadEnv({ ...BASE, SOLANA_CLUSTER: "mainnet-beta", X402_ENABLED: "true", CUSTODY_KEYPAIR: "custody.json" }),
      (e: unknown) => e instanceof Error && /mainnet-beta/.test(e.message) && /jurídico/.test(e.message),
    );
  });

  it("a custódia não pode ser a mesma chave do fee payer, do verificador, do uso ou do admin", () => {
    for (const k of ["FEE_PAYER_KEYPAIR", "VERIFIER_KEYPAIR", "USAGE_AUTHORITY_KEYPAIR"] as const) {
      assert.throws(() => loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", X402_ENABLED: "true", CUSTODY_KEYPAIR: BASE[k] }), new RegExp(k));
    }
    assert.throws(
      () => loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", ADMIN_KEYPAIR: "admin.json", X402_ENABLED: "true", CUSTODY_KEYPAIR: "admin.json" }),
      /ADMIN_KEYPAIR/,
    );
  });

  it("ligado na devnet com custódia própria sobe", () => {
    const e = loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", X402_ENABLED: "true", CUSTODY_KEYPAIR: "custody.json" });
    assert.equal(e.X402_ENABLED, true);
    assert.equal(e.CUSTODY_KEYPAIR, "custody.json");
  });

  it("piso acima do teto é recusado", () => {
    assert.throws(
      () => loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", X402_ENABLED: "true", CUSTODY_KEYPAIR: "c.json", X402_MIN_PRICE_USDC: "200", X402_MAX_PRICE_USDC: "100" }),
      /X402_MIN_PRICE_USDC/,
    );
  });
});

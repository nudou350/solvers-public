import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Na mainnet o servidor não pode carregar chave de admin/guardian/upgrade authority (docs/design-governance-v2.md §5). Puro: sem rede nem banco.

const BASE: NodeJS.ProcessEnv = {
  USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  FEE_PAYER_KEYPAIR: "fee-payer.json",
  VERIFIER_KEYPAIR: "verifier.json",
  USAGE_AUTHORITY_KEYPAIR: "usage.json",
  JWT_SECRET: "j".repeat(32),
  SERVER_KEK: "k".repeat(44),
};

// O módulo env.ts valida process.env ao ser importado (export const env = loadEnv()); sem .env.test isso lançaria.
// Preenche só o que falta e importa depois (import dinâmico), no padrão localnet. Cada arquivo de teste roda em processo próprio.
for (const [k, v] of Object.entries(BASE)) process.env[k] ??= v;
const { forbiddenMainnetKeys, loadEnv } = await import("../src/env.js");

describe("env: chaves de poder proibidas na mainnet-beta", () => {
  it("mainnet com ADMIN_KEYPAIR aborta e a mensagem diz o que remover (sem vazar o valor)", () => {
    const segredo = "[1,2,3,SEGREDO-da-chave-admin]";
    assert.throws(
      () => loadEnv({ ...BASE, SOLANA_CLUSTER: "mainnet-beta", ADMIN_KEYPAIR: segredo }),
      (e: unknown) =>
        e instanceof Error && /ADMIN_KEYPAIR/.test(e.message) && /mainnet-beta/.test(e.message) && /remova/.test(e.message) && !/SEGREDO/.test(e.message),
    );
  });

  it("mainnet também recusa guardian e upgrade authority, listando todas", () => {
    assert.throws(
      () => loadEnv({ ...BASE, SOLANA_CLUSTER: "mainnet-beta", GUARDIAN_KEYPAIR: "g.json", UPGRADE_AUTHORITY_KEYPAIR: "u.json" }),
      (e: unknown) => e instanceof Error && /GUARDIAN_KEYPAIR, UPGRADE_AUTHORITY_KEYPAIR/.test(e.message),
    );
  });

  it("mainnet sem essas chaves (ou com a variável vazia) carrega normalmente", () => {
    assert.equal(loadEnv({ ...BASE, SOLANA_CLUSTER: "mainnet-beta" }).SOLANA_CLUSTER, "mainnet-beta");
    assert.equal(loadEnv({ ...BASE, SOLANA_CLUSTER: "mainnet-beta", ADMIN_KEYPAIR: "  " }).ADMIN_KEYPAIR, "  ");
  });

  it("devnet e localnet continuam aceitando ADMIN_KEYPAIR (boot não quebra)", () => {
    assert.equal(loadEnv({ ...BASE, SOLANA_CLUSTER: "devnet", ADMIN_KEYPAIR: "admin.json" }).ADMIN_KEYPAIR, "admin.json");
    assert.equal(loadEnv({ ...BASE, SOLANA_CLUSTER: "localnet", ADMIN_KEYPAIR: "admin.json" }).SOLANA_CLUSTER, "localnet");
    assert.equal(loadEnv({ ...BASE, ADMIN_KEYPAIR: "admin.json" }).SOLANA_CLUSTER, "localnet"); // padrão = localnet
  });

  it("forbiddenMainnetKeys ignora vazio e variáveis sem relação", () => {
    assert.deepEqual(forbiddenMainnetKeys({ ADMIN_KEYPAIR: "", FEE_PAYER_KEYPAIR: "x" }), []);
    assert.deepEqual(forbiddenMainnetKeys({ ADMIN_KEYPAIR: "a" }), ["ADMIN_KEYPAIR"]);
  });
});

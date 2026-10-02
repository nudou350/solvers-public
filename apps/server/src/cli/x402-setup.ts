// Prepara a carteira de custódia do x402 (docs/x402-agentes.md, 6.3 e 6.12). Idempotente.
//
//   pnpm --filter @solvers/server cli:x402-setup --generate ~/solvers-keys/custody.json   gera uma carteira NOVA (recusa se o arquivo existir)
//   pnpm --filter @solvers/server cli:x402-setup                                          valida CUSTODY_KEYPAIR do .env e cria a ATA de USDC
//
// A custódia nunca é uma carteira já usada para outra coisa: o comando recusa se ela repetir o fee payer, o verificador, a
// autoridade de uso ou o admin. A ATA de USDC precisa existir ANTES do primeiro pagamento (o facilitator não a cria); o fee payer
// paga o rent. A custódia em si não precisa de SOL (o fee payer paga todas as taxas).

import { existsSync, writeFileSync } from "node:fs";
import nacl from "tweetnacl";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { loadSigner, type KeyPairSigner } from "@solvers/chain";
import { authorities, chain, initChain } from "../chain/index.js";
import { env } from "../env.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function custodySigner(): Promise<KeyPairSigner> {
  const generate = arg("--generate");
  if (generate) {
    if (existsSync(generate)) throw new Error(`${generate} já existe: não vou sobrescrever uma chave. Use outro caminho ou rode sem --generate.`);
    const secret = nacl.sign.keyPair().secretKey; // 64 bytes (formato da Solana CLI)
    writeFileSync(generate, JSON.stringify(Array.from(secret)), { mode: 0o600 });
    console.log(`✔ chave nova gravada em ${generate} (nunca a coloque no git)`);
    return createKeyPairSignerFromBytes(secret);
  }
  if (!env.CUSTODY_KEYPAIR) throw new Error("Defina CUSTODY_KEYPAIR (ou rode com --generate <arquivo>).");
  return loadSigner(env.CUSTODY_KEYPAIR);
}

async function main() {
  if (env.SOLANA_CLUSTER === "mainnet-beta") {
    throw new Error("A custódia do x402 não pode ser preparada na mainnet-beta (bloqueio jurídico, docs/x402-agentes.md seção 9).");
  }
  await initChain();
  const custody = await custodySigner();
  const { feePayer, verifier, usage, admin } = authorities();
  const reserved = new Map([
    [feePayer.address, "fee payer"],
    [verifier.address, "verificador"],
    [usage.address, "autoridade de uso"],
    ...(admin ? ([[admin.address, "admin"]] as const) : []),
  ]);
  const clash = reserved.get(custody.address);
  if (clash) throw new Error(`A custódia (${custody.address}) é a mesma carteira do ${clash}: use uma carteira só dela.`);

  const c = chain();
  const ata = await c.ata(custody.address);
  const { value } = await c.rpc.getAccountInfo(ata, { encoding: "base64" }).send();
  if (value) {
    console.log(`✔ a conta de USDC da custódia já existe (${ata})`);
  } else {
    const { signature } = await c.sendAsServer([await c.ensureAtaIx(custody.address)]);
    console.log(`✔ conta de USDC da custódia criada (${ata}), tx ${signature}`);
  }
  console.log(`✔ custódia: ${custody.address}`);
  console.log(`  USDC (unidades) hoje: ${await c.usdcBalance(custody.address)} (deve ficar perto de zero: o USDC entra e sai na mesma operação)`);
  console.log("\nPróximos passos no .env do servidor:");
  console.log("  X402_ENABLED=true");
  console.log(`  CUSTODY_KEYPAIR=${arg("--generate") ?? "<o mesmo valor de antes>"}`);
  console.log(`  X402_FACILITATOR_URL=${env.X402_FACILITATOR_URL}`);
}

main()
  .catch((e) => {
    console.error(`✘ ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());

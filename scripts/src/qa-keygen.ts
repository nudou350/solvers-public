// Gera (ou reaproveita) uma carteira de teste do QA e imprime o endereço. Uso: npx tsx src/qa-keygen.ts <arquivo.json>
// O arquivo é um keypair no formato JSON de 64 bytes (seed + chave pública), igual ao do Solana CLI.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const file = process.argv[2];
if (!file) throw new Error("uso: qa-keygen.ts <arquivo.json>");
if (!existsSync(file)) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...seed, ...pub]), { mode: 0o600 });
}
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
console.log(signer.address);
